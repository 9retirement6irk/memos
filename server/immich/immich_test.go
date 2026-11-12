package immich

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
	teststore "github.com/usememos/memos/store/test"
)

const (
	testSecret  = "test-secret"
	testPhotoID = "6a2a5b0e-3c8d-4a1f-9c7e-1d2b3c4d5e6f"
)

func fakeImmich(t *testing.T, contentType string) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/users/me", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "good-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = io.WriteString(w, `{"id":"u1"}`)
	})
	mux.HandleFunc("POST /api/search/metadata", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"assets":{"items":[{"id":"`+testPhotoID+`","originalFileName":"IMG_1.jpg","originalMimeType":"image/jpeg"}],"nextCursor":null}}`)
	})
	mux.HandleFunc("GET /api/assets/{id}/original", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", contentType)
		_, _ = io.WriteString(w, "photo-bytes")
	})
	return httptest.NewServer(mux)
}

type testEnv struct {
	service *Service
	mux     *http.ServeMux
	store   *store.Store
	user    *store.User
	token   string
}

func newTestEnv(ctx context.Context, t *testing.T, immichServer *httptest.Server) *testEnv {
	t.Helper()
	testStore := teststore.NewTestingStore(ctx, t)
	t.Cleanup(func() { testStore.Close() })
	user, err := testStore.CreateUser(ctx, &store.User{Username: "will", Role: store.RoleUser, Email: "will@example.com", PasswordHash: "hash"})
	require.NoError(t, err)
	token, _, err := auth.GenerateAccessTokenV2(user.ID, user.Username, string(user.Role), string(user.RowStatus), user.PasswordHash, []byte(testSecret))
	require.NoError(t, err)

	service := NewService(testStore, testSecret)
	service.HTTPClient = immichServer.Client()
	mux := http.NewServeMux()
	service.RegisterRoutes(mux)
	return &testEnv{service: service, mux: mux, store: testStore, user: user, token: token}
}

func (e *testEnv) request(method, path, body string, bearer bool) *httptest.ResponseRecorder {
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	request := httptest.NewRequest(method, path, reader)
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if bearer {
		request.Header.Set("Authorization", "Bearer "+e.token)
	}
	recorder := httptest.NewRecorder()
	e.mux.ServeHTTP(recorder, request)
	return recorder
}

func TestConnectionLifecycle(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	immichServer := fakeImmich(t, "image/jpeg")
	defer immichServer.Close()
	env := newTestEnv(ctx, t, immichServer)

	response := env.request(http.MethodGet, "/api/immich/connection", "", true)
	require.Equal(t, http.StatusOK, response.Code)
	require.JSONEq(t, `{"configured":false,"url":""}`, response.Body.String())

	// A wrong key is refused and nothing is saved.
	response = env.request(http.MethodPut, "/api/immich/connection", `{"url":"`+immichServer.URL+`","apiKey":"bad-key"}`, true)
	require.Equal(t, http.StatusBadGateway, response.Code)
	require.Contains(t, response.Body.String(), "refused the API key")
	saved, err := env.store.GetImmichConnection(ctx, env.user.ID)
	require.NoError(t, err)
	require.Nil(t, saved)

	response = env.request(http.MethodPut, "/api/immich/connection", `{"url":"`+immichServer.URL+`/api/","apiKey":"good-key"}`, true)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.JSONEq(t, `{"configured":true,"url":"`+immichServer.URL+`"}`, response.Body.String())
	// The key is never sent back.
	require.NotContains(t, response.Body.String(), "good-key")

	// Changing only the address keeps the saved key.
	response = env.request(http.MethodPut, "/api/immich/connection", `{"url":"`+immichServer.URL+`"}`, true)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	saved, err = env.store.GetImmichConnection(ctx, env.user.ID)
	require.NoError(t, err)
	require.Equal(t, "good-key", saved.APIKey)

	response = env.request(http.MethodDelete, "/api/immich/connection", "", true)
	require.Equal(t, http.StatusOK, response.Code)
	saved, err = env.store.GetImmichConnection(ctx, env.user.ID)
	require.NoError(t, err)
	require.Nil(t, saved)
}

func TestChangesNeedABearerToken(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	immichServer := fakeImmich(t, "image/jpeg")
	defer immichServer.Close()
	env := newTestEnv(ctx, t, immichServer)

	response := env.request(http.MethodPut, "/api/immich/connection", `{"url":"`+immichServer.URL+`","apiKey":"good-key"}`, false)
	require.Equal(t, http.StatusUnauthorized, response.Code)
	response = env.request(http.MethodGet, "/api/immich/photos", "", false)
	require.Equal(t, http.StatusUnauthorized, response.Code)
}

func TestPhotosNeedAConnection(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	immichServer := fakeImmich(t, "image/jpeg")
	defer immichServer.Close()
	env := newTestEnv(ctx, t, immichServer)

	response := env.request(http.MethodGet, "/api/immich/photos", "", true)
	require.Equal(t, http.StatusNotFound, response.Code)
}

func TestPhotoProxy(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	immichServer := fakeImmich(t, "image/jpeg")
	defer immichServer.Close()
	env := newTestEnv(ctx, t, immichServer)
	require.NoError(t, env.store.UpsertImmichConnection(ctx, env.user.ID, &store.ImmichConnection{URL: immichServer.URL, APIKey: "good-key"}))

	response := env.request(http.MethodGet, "/api/immich/photos", "", true)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.JSONEq(t, `{"photos":[{"id":"`+testPhotoID+`","fileName":"IMG_1.jpg","mimeType":"image/jpeg","takenAt":"","width":0,"height":0}],"next":""}`, response.Body.String())

	response = env.request(http.MethodGet, "/api/immich/photos/"+testPhotoID+"/original", "", true)
	require.Equal(t, http.StatusOK, response.Code)
	require.Equal(t, "image/jpeg", response.Header().Get("Content-Type"))
	require.Equal(t, "nosniff", response.Header().Get("X-Content-Type-Options"))
	require.Equal(t, "photo-bytes", response.Body.String())

	response = env.request(http.MethodGet, "/api/immich/photos/not-a-photo/original", "", true)
	require.Equal(t, http.StatusBadRequest, response.Code)
	response = env.request(http.MethodGet, "/api/immich/photos?album=../albums", "", true)
	require.Equal(t, http.StatusBadRequest, response.Code)
}

func TestPhotoProxyPassesOnlyImages(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	immichServer := fakeImmich(t, "text/html")
	defer immichServer.Close()
	env := newTestEnv(ctx, t, immichServer)
	require.NoError(t, env.store.UpsertImmichConnection(ctx, env.user.ID, &store.ImmichConnection{URL: immichServer.URL, APIKey: "good-key"}))

	response := env.request(http.MethodGet, "/api/immich/photos/"+testPhotoID+"/original", "", true)
	require.Equal(t, http.StatusBadGateway, response.Code)
	require.NotContains(t, response.Body.String(), "photo-bytes")
}

func TestConnectionKeepsWhereARedirectLeads(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	immichServer := fakeImmich(t, "image/jpeg")
	defer immichServer.Close()
	// Like a reverse proxy sending http:// on to https:// on the same host.
	frontDoor := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, immichServer.URL+r.URL.RequestURI(), http.StatusMovedPermanently)
	}))
	defer frontDoor.Close()
	env := newTestEnv(ctx, t, immichServer)

	response := env.request(http.MethodPut, "/api/immich/connection", `{"url":"`+frontDoor.URL+`","apiKey":"good-key"}`, true)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.JSONEq(t, `{"configured":true,"url":"`+immichServer.URL+`"}`, response.Body.String())
	saved, err := env.store.GetImmichConnection(ctx, env.user.ID)
	require.NoError(t, err)
	require.Equal(t, immichServer.URL, saved.URL)
}

func TestConnectionSaysWhyItFailed(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	immichServer := fakeImmich(t, "image/jpeg")
	defer immichServer.Close()
	env := newTestEnv(ctx, t, immichServer)

	// An address with a path in front of the API, as when the web app's page is pasted.
	response := env.request(http.MethodPut, "/api/immich/connection", `{"url":"`+immichServer.URL+`/photos","apiKey":"good-key"}`, true)
	require.Equal(t, http.StatusBadGateway, response.Code)
	require.Contains(t, response.Body.String(), "not the Immich API")
	require.NotContains(t, response.Body.String(), "good-key")
}
