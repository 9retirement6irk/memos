// Package dawarich is a small client for a user's own Dawarich server, the
// self-hosted location history: where they were, the routes they took and the
// places they visited.
//
// It reads only what a journal needs. Points come back as position and time
// alone; the Wi-Fi names, battery levels and device details Dawarich keeps
// with each point are never decoded.
package dawarich

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/safehttp"
)

const (
	requestTimeout = 30 * time.Second
	// pageSize is how many points one request asks for.
	pageSize = 1000
	// maxPages bounds one range's points; a day of tracking is a few thousand.
	maxPages = 30
	// maxBodyBytes bounds a JSON answer.
	maxBodyBytes = 16 << 20
)

// Service describes Dawarich for failure messages.
var Service = safehttp.Service{
	Name:        "Dawarich",
	ExampleHost: "192.168.1.20:3000",
	DefaultPort: "3000",
	KeyHelp:     "Copy it again from Account › API access in Dawarich.",
}

// Explain says why a call to Dawarich failed and what to change.
func Explain(err error) string {
	return safehttp.Explain(err, Service)
}

// NewHTTPClient returns the HTTP client the package uses by default.
func NewHTTPClient() *http.Client {
	return safehttp.NewClient(requestTimeout)
}

// NormalizeURL checks a Dawarich address a person typed and returns its base.
func NormalizeURL(rawURL string) (string, error) {
	normalized, err := safehttp.NormalizeBaseURL(rawURL, Service.ExampleHost, "/api/v1", "/api")
	if err != nil {
		return "", errors.Wrap(err, "dawarich")
	}
	return normalized, nil
}

// Client calls one Dawarich server with one user's API key.
type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
	// keyInQuery is set once the server refused the key as a Bearer token and
	// took it as the api_key parameter, as older versions want for points.
	keyInQuery bool
}

// NewClient returns a client for the server at rawURL. A nil httpClient uses
// NewHTTPClient.
func NewClient(rawURL, apiKey string, httpClient *http.Client) (*Client, error) {
	baseURL, err := NormalizeURL(rawURL)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(apiKey) == "" {
		return nil, errors.New("dawarich: the API key is empty")
	}
	if httpClient == nil {
		httpClient = NewHTTPClient()
	}
	return &Client{baseURL: baseURL, apiKey: strings.TrimSpace(apiKey), http: httpClient}, nil
}

// BaseURL is the server address the client calls: the one it was given, or
// where a followed redirect moved it.
func (c *Client) BaseURL() string {
	return c.baseURL
}

func (c *Client) get(ctx context.Context, path string, query url.Values, keyInQuery bool) (*http.Response, error) {
	query = cloneValues(query)
	if keyInQuery {
		query.Set("api_key", c.apiKey)
	}
	target := c.baseURL + "/api/v1" + path
	if len(query) > 0 {
		target += "?" + query.Encode()
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, errors.Wrap(err, "dawarich: failed to build request")
	}
	request.Header.Set("Accept", "application/json")
	if !keyInQuery {
		request.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
	response, err := c.http.Do(request)
	if err != nil {
		// The URL in the error may carry the key; keep only the host.
		return nil, errors.Wrap(stripKey(err), "dawarich: request failed")
	}
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		drain(response)
		return nil, safehttp.ErrUnauthorized
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		drain(response)
		return nil, &safehttp.StatusError{Code: response.StatusCode}
	}
	c.baseURL = safehttp.MovedBase(c.baseURL, request.URL, response.Request.URL)
	return response, nil
}

// getJSON decodes a GET answer into out, trying the key as a Bearer token
// first and as the api_key parameter when that is refused.
func (c *Client) getJSON(ctx context.Context, path string, query url.Values, out any) (http.Header, error) {
	response, err := c.get(ctx, path, query, c.keyInQuery)
	if errors.Is(err, safehttp.ErrUnauthorized) && !c.keyInQuery {
		response, err = c.get(ctx, path, query, true)
		if err == nil {
			c.keyInQuery = true
		}
	}
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if err := json.NewDecoder(io.LimitReader(response.Body, maxBodyBytes)).Decode(out); err != nil {
		return nil, errors.Wrap(safehttp.ErrUnexpectedAnswer, err.Error())
	}
	return response.Header, nil
}

// Check confirms the address and key work.
func (c *Client) Check(ctx context.Context) error {
	// Points over an empty moment: allowed for any key, small, and present in
	// every Dawarich version that has the API.
	now := time.Now().UTC()
	_, err := c.Points(ctx, now.Add(-time.Minute), now)
	return err
}

// Point is where the user was at one moment.
type Point struct {
	Latitude  float64
	Longitude float64
	Time      time.Time
}

type rawPoint struct {
	Latitude  flexFloat `json:"latitude"`
	Longitude flexFloat `json:"longitude"`
	Timestamp flexFloat `json:"timestamp"`
}

// Points returns where the user was between start and end, oldest first.
func (c *Client) Points(ctx context.Context, start, end time.Time) ([]Point, error) {
	if !end.After(start) {
		return nil, errors.New("dawarich: the time range is empty")
	}
	points := []Point{}
	for page := 1; page <= maxPages; page++ {
		query := url.Values{}
		query.Set("start_at", start.UTC().Format(time.RFC3339))
		query.Set("end_at", end.UTC().Format(time.RFC3339))
		query.Set("per_page", strconv.Itoa(pageSize))
		query.Set("page", strconv.Itoa(page))
		query.Set("order", "asc")
		raw := []rawPoint{}
		header, err := c.getJSON(ctx, "/points", query, &raw)
		if err != nil {
			return nil, err
		}
		for _, point := range raw {
			if !point.Latitude.ok || !point.Longitude.ok || !point.Timestamp.ok {
				continue
			}
			points = append(points, Point{
				Latitude:  point.Latitude.value,
				Longitude: point.Longitude.value,
				Time:      time.Unix(int64(point.Timestamp.value), 0).UTC(),
			})
		}
		// Trust the page count when the server sends one; otherwise a short
		// page is the last.
		if totalPages, err := strconv.Atoi(header.Get("X-Total-Pages")); err == nil {
			if page >= totalPages {
				break
			}
		} else if len(raw) < pageSize {
			break
		}
	}
	return points, nil
}

// Visit is a stay at one place.
type Visit struct {
	Name      string
	Start     time.Time
	End       time.Time
	Latitude  *float64
	Longitude *float64
}

type rawVisit struct {
	Name        string `json:"name"`
	DisplayName string `json:"display_name"`
	Status      string `json:"status"`
	StartedAt   string `json:"started_at"`
	EndedAt     string `json:"ended_at"`
	Place       *struct {
		Latitude  *float64 `json:"latitude"`
		Longitude *float64 `json:"longitude"`
	} `json:"place"`
	Center *struct {
		Latitude  *float64 `json:"latitude"`
		Longitude *float64 `json:"longitude"`
	} `json:"center"`
}

// Visits returns the stays between start and end that the user hasn't
// declined, oldest first.
func (c *Client) Visits(ctx context.Context, start, end time.Time) ([]Visit, error) {
	if !end.After(start) {
		return nil, errors.New("dawarich: the time range is empty")
	}
	query := url.Values{}
	query.Set("start_at", start.UTC().Format(time.RFC3339))
	query.Set("end_at", end.UTC().Format(time.RFC3339))
	raw := []rawVisit{}
	if _, err := c.getJSON(ctx, "/visits", query, &raw); err != nil {
		return nil, err
	}
	visits := []Visit{}
	for _, visit := range raw {
		if visit.Status == "declined" {
			continue
		}
		startedAt, errStart := time.Parse(time.RFC3339, visit.StartedAt)
		endedAt, errEnd := time.Parse(time.RFC3339, visit.EndedAt)
		if errStart != nil || errEnd != nil {
			continue
		}
		name := visit.Name
		if name == "" {
			name = visit.DisplayName
		}
		item := Visit{Name: name, Start: startedAt.UTC(), End: endedAt.UTC()}
		switch {
		case visit.Place != nil && visit.Place.Latitude != nil && visit.Place.Longitude != nil:
			item.Latitude, item.Longitude = visit.Place.Latitude, visit.Place.Longitude
		case visit.Center != nil && visit.Center.Latitude != nil && visit.Center.Longitude != nil:
			item.Latitude, item.Longitude = visit.Center.Latitude, visit.Center.Longitude
		default:
		}
		visits = append(visits, item)
	}
	return visits, nil
}

// Track is one journey Dawarich cut from the points: a line with its times,
// length and the way the user mostly travelled.
type Track struct {
	ID       int64
	Start    time.Time
	End      time.Time
	Distance float64 // meters
	Mode     string  // like "walking" or "driving"; empty when unknown
	Path     []Point // the line, oldest first; Time is zero
}

type rawTrackCollection struct {
	Features []struct {
		Geometry struct {
			Type        string          `json:"type"`
			Coordinates json.RawMessage `json:"coordinates"`
		} `json:"geometry"`
		Properties struct {
			ID           flexFloat `json:"id"`
			StartAt      string    `json:"start_at"`
			EndAt        string    `json:"end_at"`
			Distance     flexFloat `json:"distance"`
			DominantMode string    `json:"dominant_mode"`
		} `json:"properties"`
	} `json:"features"`
}

// trackPageSize keeps one page of tracks, each with its whole line, small.
const trackPageSize = 100

// Tracks returns the journeys that overlap start..end, oldest first. Servers
// from before tracks had an API answer with a *safehttp.StatusError of 404.
func (c *Client) Tracks(ctx context.Context, start, end time.Time) ([]Track, error) {
	if !end.After(start) {
		return nil, errors.New("dawarich: the time range is empty")
	}
	tracks := []Track{}
	for page := 1; page <= maxPages; page++ {
		query := url.Values{}
		query.Set("start_at", start.UTC().Format(time.RFC3339))
		query.Set("end_at", end.UTC().Format(time.RFC3339))
		query.Set("per_page", strconv.Itoa(trackPageSize))
		query.Set("page", strconv.Itoa(page))
		raw := rawTrackCollection{}
		header, err := c.getJSON(ctx, "/tracks", query, &raw)
		if err != nil {
			return nil, err
		}
		for _, feature := range raw.Features {
			startedAt, errStart := time.Parse(time.RFC3339, feature.Properties.StartAt)
			endedAt, errEnd := time.Parse(time.RFC3339, feature.Properties.EndAt)
			path := linePoints(feature.Geometry.Type, feature.Geometry.Coordinates)
			if errStart != nil || errEnd != nil || len(path) < 2 {
				continue
			}
			mode := feature.Properties.DominantMode
			if mode == "unknown" {
				mode = ""
			}
			tracks = append(tracks, Track{
				ID:       int64(feature.Properties.ID.value),
				Start:    startedAt.UTC(),
				End:      endedAt.UTC(),
				Distance: feature.Properties.Distance.value,
				Mode:     mode,
				Path:     path,
			})
		}
		// Without a page count, the first page is all there is.
		totalPages, parseErr := strconv.Atoi(header.Get("X-Total-Pages"))
		if parseErr != nil || page >= totalPages {
			break
		}
	}
	// Dawarich lists the newest first.
	slices.SortFunc(tracks, func(a, b Track) int { return a.Start.Compare(b.Start) })
	return tracks, nil
}

// linePoints reads a GeoJSON LineString or MultiLineString, whose positions
// are [longitude, latitude, ...].
func linePoints(kind string, coordinates json.RawMessage) []Point {
	var lines [][][]float64
	switch kind {
	case "LineString":
		var line [][]float64
		if json.Unmarshal(coordinates, &line) != nil {
			return nil
		}
		lines = [][][]float64{line}
	case "MultiLineString":
		if json.Unmarshal(coordinates, &lines) != nil {
			return nil
		}
	default:
		return nil
	}
	points := []Point{}
	for _, line := range lines {
		for _, position := range line {
			if len(position) < 2 {
				continue
			}
			points = append(points, Point{Latitude: position[1], Longitude: position[0]})
		}
	}
	return points
}

// flexFloat reads a number Dawarich may send as a JSON number or a string.
type flexFloat struct {
	value float64
	ok    bool
}

func (f *flexFloat) UnmarshalJSON(data []byte) error {
	text := strings.Trim(string(data), `"`)
	if text == "" || text == "null" {
		return nil
	}
	// A point without a usable number is skipped, not fatal.
	if value, err := strconv.ParseFloat(text, 64); err == nil {
		f.value, f.ok = value, true
	}
	return nil
}

func cloneValues(values url.Values) url.Values {
	clone := url.Values{}
	for key, list := range values {
		clone[key] = append([]string(nil), list...)
	}
	return clone
}

func drain(response *http.Response) {
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 64<<10))
	response.Body.Close()
}

// stripKey removes the query from a failed request's URL, so the api_key
// parameter never reaches a log or a message.
func stripKey(err error) error {
	var urlError *url.Error
	if errors.As(err, &urlError) {
		if parsed, parseErr := url.Parse(urlError.URL); parseErr == nil {
			parsed.RawQuery = ""
			urlError.URL = parsed.String()
		}
	}
	return err
}
