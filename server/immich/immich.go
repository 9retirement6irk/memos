// Package immich serves /api/immich: each signed-in user's connection to their
// own Immich photo server, and a read-only proxy the photo picker browses it
// through. The browser never sees the user's Immich API key, and the server
// only ever calls Immich's fixed photo-reading endpoints with it.
package immich

import (
	"context"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/httphandler"
	immichclient "github.com/usememos/memos/internal/immich"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
)

// maxRequestBytes bounds the body of a connection update.
const maxRequestBytes = 16 << 10

// Service handles the /api/immich routes.
type Service struct {
	Store         *store.Store
	authenticator *auth.Authenticator
	// HTTPClient calls Immich; nil uses immichclient.NewHTTPClient. Tests
	// replace it to reach a fake server on loopback.
	HTTPClient *http.Client
}

// NewService returns the service for the store and the instance secret.
func NewService(store *store.Store, secret string) *Service {
	return &Service{Store: store, authenticator: auth.NewAuthenticator(store, secret)}
}

// RegisterRoutes adds the /api/immich routes to mux.
func (s *Service) RegisterRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/immich/connection", httphandler.Func(s.getConnection))
	mux.Handle("PUT /api/immich/connection", httphandler.Func(s.putConnection))
	mux.Handle("DELETE /api/immich/connection", httphandler.Func(s.deleteConnection))
	mux.Handle("GET /api/immich/albums", httphandler.Func(s.listAlbums))
	mux.Handle("GET /api/immich/photos", httphandler.Func(s.listPhotos))
	mux.Handle("GET /api/immich/photos/{id}/thumbnail", httphandler.Func(s.servePhotoThumbnail))
	mux.Handle("GET /api/immich/photos/{id}/original", httphandler.Func(s.servePhotoOriginal))
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

var errNotSignedIn = &httphandler.Error{Code: http.StatusUnauthorized, Message: "sign in to use Immich"}

// currentUser resolves the signed-in user from a Bearer token or the session
// cookie. Reads accept the cookie, so <img> tags can load thumbnails.
func (s *Service) currentUser(r *http.Request) (*store.User, error) {
	user, err := s.authenticator.AuthenticateToUser(r.Context(), r.Header.Get("Authorization"), r.Header.Get("Cookie"))
	if err != nil || user == nil {
		return nil, errNotSignedIn
	}
	return user, nil
}

// currentUserFromBearer resolves the user from a Bearer token only. Changes
// require it, so another site can't make a signed-in browser change them
// with the session cookie alone.
func (s *Service) currentUserFromBearer(r *http.Request) (*store.User, error) {
	if auth.ExtractBearerToken(r.Header.Get("Authorization")) == "" {
		return nil, errNotSignedIn
	}
	user, err := s.authenticator.AuthenticateToUser(r.Context(), r.Header.Get("Authorization"), "")
	if err != nil || user == nil {
		return nil, errNotSignedIn
	}
	return user, nil
}

func (s *Service) newClient(connection *store.ImmichConnection) (*immichclient.Client, error) {
	return immichclient.NewClient(connection.URL, connection.APIKey, s.HTTPClient)
}

// clientFor returns a client for the user's saved connection.
func (s *Service) clientFor(ctx context.Context, user *store.User) (*immichclient.Client, error) {
	connection, err := s.Store.GetImmichConnection(ctx, user.ID)
	if err != nil {
		return nil, &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to read the Immich connection", Cause: err}
	}
	if connection == nil {
		return nil, &httphandler.Error{Code: http.StatusNotFound, Message: "connect Immich in Settings first"}
	}
	client, err := s.newClient(connection)
	if err != nil {
		return nil, &httphandler.Error{Code: http.StatusBadRequest, Message: "the saved Immich connection is invalid; connect it again", Cause: err}
	}
	return client, nil
}

// immichError turns a failed Immich call into an answer for the browser.
func immichError(err error) error {
	if errors.Is(err, immichclient.ErrUnauthorized) {
		return &httphandler.Error{Code: http.StatusBadGateway, Message: "Immich refused the API key", Cause: err}
	}
	return &httphandler.Error{Code: http.StatusBadGateway, Message: "Immich could not be reached", Cause: err}
}

func (s *Service) getConnection(w http.ResponseWriter, r *http.Request) error {
	user, err := s.currentUser(r)
	if err != nil {
		return err
	}
	connection, err := s.Store.GetImmichConnection(r.Context(), user.ID)
	if err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to read the Immich connection", Cause: err}
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
	if mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mediaType != "application/json" {
		return &httphandler.Error{Code: http.StatusUnsupportedMediaType, Message: "send the connection as JSON"}
	}
	request := &ConnectionRequest{}
	if err := json.NewDecoder(io.LimitReader(r.Body, maxRequestBytes)).Decode(request); err != nil {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid connection"}
	}
	baseURL, err := immichclient.NormalizeURL(request.URL)
	if err != nil {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: strings.TrimPrefix(err.Error(), "immich: ")}
	}

	apiKey := strings.TrimSpace(request.APIKey)
	if apiKey == "" {
		// Changing only the address keeps the key already saved.
		saved, err := s.Store.GetImmichConnection(r.Context(), user.ID)
		if err != nil {
			return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to read the Immich connection", Cause: err}
		}
		if saved == nil {
			return &httphandler.Error{Code: http.StatusBadRequest, Message: "an API key is required"}
		}
		apiKey = saved.APIKey
	}

	connection := &store.ImmichConnection{URL: baseURL, APIKey: apiKey}
	client, err := s.newClient(connection)
	if err != nil {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: strings.TrimPrefix(err.Error(), "immich: ")}
	}
	// Save only a connection that works.
	if _, err := client.CurrentUser(r.Context()); err != nil {
		return immichError(err)
	}
	if err := s.Store.UpsertImmichConnection(r.Context(), user.ID, connection); err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to save the Immich connection", Cause: err}
	}
	return httphandler.JSON(w, http.StatusOK, ConnectionResponse{Configured: true, URL: baseURL})
}

func (s *Service) deleteConnection(w http.ResponseWriter, r *http.Request) error {
	user, err := s.currentUserFromBearer(r)
	if err != nil {
		return err
	}
	if err := s.Store.DeleteImmichConnection(r.Context(), user.ID); err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to remove the Immich connection", Cause: err}
	}
	return httphandler.JSON(w, http.StatusOK, ConnectionResponse{})
}

// AlbumResponse is one album in the picker.
type AlbumResponse struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	PhotoCount       int    `json:"photoCount"`
	ThumbnailPhotoID string `json:"thumbnailPhotoId"`
}

func (s *Service) listAlbums(w http.ResponseWriter, r *http.Request) error {
	user, err := s.currentUser(r)
	if err != nil {
		return err
	}
	client, err := s.clientFor(r.Context(), user)
	if err != nil {
		return err
	}
	albums, err := client.Albums(r.Context())
	if err != nil {
		return immichError(err)
	}
	response := make([]AlbumResponse, 0, len(albums))
	for _, album := range albums {
		response = append(response, AlbumResponse{ID: album.ID, Name: album.Name, PhotoCount: album.AssetCount, ThumbnailPhotoID: album.ThumbnailAssetID})
	}
	return httphandler.JSON(w, http.StatusOK, response)
}

// PhotoResponse is one photo in the picker.
type PhotoResponse struct {
	ID       string `json:"id"`
	FileName string `json:"fileName"`
	MimeType string `json:"mimeType"`
	TakenAt  string `json:"takenAt"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
}

// PhotoPageResponse is one page of photos; Next is empty on the last page.
type PhotoPageResponse struct {
	Photos []PhotoResponse `json:"photos"`
	Next   string          `json:"next"`
}

func (s *Service) listPhotos(w http.ResponseWriter, r *http.Request) error {
	user, err := s.currentUser(r)
	if err != nil {
		return err
	}
	albumID := r.URL.Query().Get("album")
	if albumID != "" && !immichclient.IsID(albumID) {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid album"}
	}
	client, err := s.clientFor(r.Context(), user)
	if err != nil {
		return err
	}
	page, err := client.SearchPhotos(r.Context(), albumID, r.URL.Query().Get("next"))
	if err != nil {
		return immichError(err)
	}
	response := PhotoPageResponse{Photos: make([]PhotoResponse, 0, len(page.Photos)), Next: page.Next}
	for _, photo := range page.Photos {
		response.Photos = append(response.Photos, PhotoResponse{
			ID: photo.ID, FileName: photo.FileName, MimeType: photo.MimeType, TakenAt: photo.TakenAt, Width: photo.Width, Height: photo.Height,
		})
	}
	return httphandler.JSON(w, http.StatusOK, response)
}

func (s *Service) servePhotoThumbnail(w http.ResponseWriter, r *http.Request) error {
	return s.servePhoto(w, r, false)
}

func (s *Service) servePhotoOriginal(w http.ResponseWriter, r *http.Request) error {
	return s.servePhoto(w, r, true)
}

// servePhoto streams a photo from Immich. Only images pass through, so the
// proxy can't be used to fetch anything else from the user's network.
func (s *Service) servePhoto(w http.ResponseWriter, r *http.Request, original bool) error {
	user, err := s.currentUser(r)
	if err != nil {
		return err
	}
	photoID := r.PathValue("id")
	if !immichclient.IsID(photoID) {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid photo"}
	}
	client, err := s.clientFor(r.Context(), user)
	if err != nil {
		return err
	}
	var response *http.Response
	if original {
		response, err = client.Original(r.Context(), photoID)
	} else {
		response, err = client.Thumbnail(r.Context(), photoID)
	}
	if err != nil {
		return immichError(err)
	}
	defer response.Body.Close()

	contentType := response.Header.Get("Content-Type")
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil || !strings.HasPrefix(mediaType, "image/") || mediaType == "image/svg+xml" {
		return &httphandler.Error{Code: http.StatusBadGateway, Message: "Immich did not send an image"}
	}

	header := w.Header()
	header.Set("Content-Type", mediaType)
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Content-Security-Policy", "default-src 'none'")
	header.Set("Cache-Control", "private, max-age=3600")
	if length := response.Header.Get("Content-Length"); length != "" {
		if _, err := strconv.ParseInt(length, 10, 64); err == nil {
			header.Set("Content-Length", length)
		}
	}
	w.WriteHeader(http.StatusOK)
	_, err = io.Copy(w, response.Body)
	return err
}
