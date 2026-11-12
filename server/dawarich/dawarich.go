// Package dawarich serves /api/dawarich: each signed-in user's connection to
// their own Dawarich location history, and a read-only proxy the journal reads
// routes and visited places through. The browser never sees the API key, and
// only position and time leave the server, never the Wi-Fi names or device
// details Dawarich keeps with each point.
package dawarich

import (
	"context"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"time"

	dawarichclient "github.com/usememos/memos/internal/dawarich"
	"github.com/usememos/memos/internal/httphandler"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
)

const (
	// maxRequestBytes bounds the body of a connection update.
	maxRequestBytes = 16 << 10
	// maxRange bounds one request's time range.
	maxRange = 8 * 24 * time.Hour
	// maxPoints bounds the points sent to the browser; a route keeps its shape
	// with far fewer than a day of tracking holds.
	maxPoints = 1500
)

// Connection is what the store keeps for a user.
type Connection struct {
	URL    string `json:"url"`
	APIKey string `json:"apiKey"`
}

// Service handles the /api/dawarich routes.
type Service struct {
	Store         *store.Store
	authenticator *auth.Authenticator
	// HTTPClient calls Dawarich; nil uses dawarichclient.NewHTTPClient. Tests
	// replace it to reach a fake server on loopback.
	HTTPClient *http.Client
}

// NewService returns the service for the store and the instance secret.
func NewService(store *store.Store, secret string) *Service {
	return &Service{Store: store, authenticator: auth.NewAuthenticator(store, secret)}
}

// RegisterRoutes adds the /api/dawarich routes to mux.
func (s *Service) RegisterRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/dawarich/connection", httphandler.Func(s.getConnection))
	mux.Handle("PUT /api/dawarich/connection", httphandler.Func(s.putConnection))
	mux.Handle("DELETE /api/dawarich/connection", httphandler.Func(s.deleteConnection))
	mux.Handle("GET /api/dawarich/points", httphandler.Func(s.listPoints))
	mux.Handle("GET /api/dawarich/visits", httphandler.Func(s.listVisits))
}

// ConnectionResponse is what a user sees of their connection: never the key.
type ConnectionResponse struct {
	Configured bool   `json:"configured"`
	URL        string `json:"url"`
}

// ConnectionRequest updates the connection. An empty APIKey keeps the saved one.
type ConnectionRequest struct {
	URL    string `json:"url"`
	APIKey string `json:"apiKey"`
}

var errNotSignedIn = &httphandler.Error{Code: http.StatusUnauthorized, Message: "sign in to use Dawarich"}

func (s *Service) currentUser(r *http.Request) (*store.User, error) {
	user, err := s.authenticator.AuthenticateToUser(r.Context(), r.Header.Get("Authorization"), r.Header.Get("Cookie"))
	if err != nil || user == nil {
		return nil, errNotSignedIn
	}
	return user, nil
}

// currentUserFromBearer requires a Bearer token, so another site can't make a
// signed-in browser change the connection with the session cookie alone.
func (s *Service) currentUserFromBearer(r *http.Request) (*store.User, error) {
	if auth.ExtractBearerToken(r.Header.Get("Authorization")) == "" {
		return nil, errNotSignedIn
	}
	return s.currentUser(r)
}

func (s *Service) loadConnection(ctx context.Context, userID int32) (*Connection, error) {
	connection := &Connection{}
	found, err := s.Store.GetUserRecord(ctx, store.UserRecordDawarichConnection, userID, connection)
	if err != nil {
		return nil, &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to read the Dawarich connection", Cause: err}
	}
	if !found {
		return nil, nil
	}
	return connection, nil
}

func (s *Service) getConnection(w http.ResponseWriter, r *http.Request) error {
	user, err := s.currentUser(r)
	if err != nil {
		return err
	}
	connection, err := s.loadConnection(r.Context(), user.ID)
	if err != nil {
		return err
	}
	if connection == nil {
		return httphandler.JSON(w, http.StatusOK, ConnectionResponse{})
	}
	return httphandler.JSON(w, http.StatusOK, ConnectionResponse{Configured: true, URL: connection.URL})
}

func (s *Service) putConnection(w http.ResponseWriter, r *http.Request) error {
	user, err := s.currentUserFromBearer(r)
	if err != nil {
		return err
	}
	request := ConnectionRequest{}
	if err := json.NewDecoder(io.LimitReader(r.Body, maxRequestBytes)).Decode(&request); err != nil {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid request body", Cause: err}
	}
	baseURL, err := dawarichclient.NormalizeURL(request.URL)
	if err != nil {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: err.Error()}
	}
	apiKey := request.APIKey
	if apiKey == "" {
		saved, err := s.loadConnection(r.Context(), user.ID)
		if err != nil {
			return err
		}
		if saved == nil {
			return &httphandler.Error{Code: http.StatusBadRequest, Message: "enter your Dawarich API key"}
		}
		apiKey = saved.APIKey
	}
	client, err := dawarichclient.NewClient(baseURL, apiKey, s.HTTPClient)
	if err != nil {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: err.Error()}
	}
	// Save only a connection that works, at the address it ended up at.
	if err := client.Check(r.Context()); err != nil {
		return dawarichError(err)
	}
	connection := &Connection{URL: client.BaseURL(), APIKey: apiKey}
	if err := s.Store.UpsertUserRecord(r.Context(), store.UserRecordDawarichConnection, user.ID, connection); err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to save the Dawarich connection", Cause: err}
	}
	return httphandler.JSON(w, http.StatusOK, ConnectionResponse{Configured: true, URL: connection.URL})
}

func (s *Service) deleteConnection(w http.ResponseWriter, r *http.Request) error {
	user, err := s.currentUserFromBearer(r)
	if err != nil {
		return err
	}
	if err := s.Store.DeleteUserRecord(r.Context(), store.UserRecordDawarichConnection, user.ID); err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to remove the Dawarich connection", Cause: err}
	}
	return httphandler.JSON(w, http.StatusOK, ConnectionResponse{})
}

func (s *Service) clientFor(r *http.Request) (*dawarichclient.Client, time.Time, time.Time, error) {
	user, err := s.currentUser(r)
	if err != nil {
		return nil, time.Time{}, time.Time{}, err
	}
	start, errStart := time.Parse(time.RFC3339, r.URL.Query().Get("start"))
	end, errEnd := time.Parse(time.RFC3339, r.URL.Query().Get("end"))
	if errStart != nil || errEnd != nil || !end.After(start) || end.Sub(start) > maxRange {
		return nil, time.Time{}, time.Time{}, &httphandler.Error{Code: http.StatusBadRequest, Message: "start and end must be RFC 3339 times at most 8 days apart"}
	}
	connection, err := s.loadConnection(r.Context(), user.ID)
	if err != nil {
		return nil, time.Time{}, time.Time{}, err
	}
	if connection == nil {
		return nil, time.Time{}, time.Time{}, &httphandler.Error{Code: http.StatusNotFound, Message: "connect Dawarich in Settings first"}
	}
	client, err := dawarichclient.NewClient(connection.URL, connection.APIKey, s.HTTPClient)
	if err != nil {
		return nil, time.Time{}, time.Time{}, &httphandler.Error{Code: http.StatusInternalServerError, Message: "the saved Dawarich connection is invalid", Cause: err}
	}
	return client, start, end, nil
}

// PointResponse is where the user was at one moment.
type PointResponse struct {
	Latitude  float64 `json:"lat"`
	Longitude float64 `json:"lon"`
	Time      string  `json:"time"`
}

// PointsResponse is a route: its points, oldest first, and how far it went.
type PointsResponse struct {
	Points []PointResponse `json:"points"`
	// DistanceMeters is the length of the whole route, before thinning.
	DistanceMeters float64 `json:"distanceMeters"`
}

func (s *Service) listPoints(w http.ResponseWriter, r *http.Request) error {
	client, start, end, err := s.clientFor(r)
	if err != nil {
		return err
	}
	points, err := client.Points(r.Context(), start, end)
	if err != nil {
		return dawarichError(err)
	}
	response := PointsResponse{Points: []PointResponse{}, DistanceMeters: routeLength(points)}
	for _, point := range thin(points, maxPoints) {
		response.Points = append(response.Points, PointResponse{Latitude: point.Latitude, Longitude: point.Longitude, Time: point.Time.Format(time.RFC3339)})
	}
	return httphandler.JSON(w, http.StatusOK, response)
}

// VisitResponse is a stay at one place.
type VisitResponse struct {
	Name      string   `json:"name"`
	Start     string   `json:"start"`
	End       string   `json:"end"`
	Latitude  *float64 `json:"lat,omitempty"`
	Longitude *float64 `json:"lon,omitempty"`
}

// VisitsResponse lists stays, oldest first.
type VisitsResponse struct {
	Visits []VisitResponse `json:"visits"`
}

func (s *Service) listVisits(w http.ResponseWriter, r *http.Request) error {
	client, start, end, err := s.clientFor(r)
	if err != nil {
		return err
	}
	visits, err := client.Visits(r.Context(), start, end)
	if err != nil {
		return dawarichError(err)
	}
	response := VisitsResponse{Visits: []VisitResponse{}}
	for _, visit := range visits {
		response.Visits = append(response.Visits, VisitResponse{
			Name: visit.Name, Start: visit.Start.Format(time.RFC3339), End: visit.End.Format(time.RFC3339),
			Latitude: visit.Latitude, Longitude: visit.Longitude,
		})
	}
	return httphandler.JSON(w, http.StatusOK, response)
}

// thin keeps at most limit points, evenly spread, always with the first and last.
func thin(points []dawarichclient.Point, limit int) []dawarichclient.Point {
	if len(points) <= limit || limit < 2 {
		return points
	}
	kept := make([]dawarichclient.Point, 0, limit)
	step := float64(len(points)-1) / float64(limit-1)
	for i := range limit {
		kept = append(kept, points[int(math.Round(float64(i)*step))])
	}
	return kept
}

// routeLength is the route's length in meters along the great circle.
func routeLength(points []dawarichclient.Point) float64 {
	const earthRadius = 6371000.0
	total := 0.0
	for i := 1; i < len(points); i++ {
		lat1, lat2 := points[i-1].Latitude*math.Pi/180, points[i].Latitude*math.Pi/180
		dLat := lat2 - lat1
		dLon := (points[i].Longitude - points[i-1].Longitude) * math.Pi / 180
		a := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(lat1)*math.Cos(lat2)*math.Sin(dLon/2)*math.Sin(dLon/2)
		total += 2 * earthRadius * math.Asin(math.Min(1, math.Sqrt(a)))
	}
	return total
}

// dawarichError turns a failed Dawarich call into an answer for the browser
// that says what went wrong and what to change.
func dawarichError(err error) error {
	return &httphandler.Error{Code: http.StatusBadGateway, Message: dawarichclient.Explain(err), Cause: err}
}
