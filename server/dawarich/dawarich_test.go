package dawarich

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	dawarichclient "github.com/usememos/memos/internal/dawarich"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
	teststore "github.com/usememos/memos/store/test"
)

const testSecret = "test-secret"

func fakeDawarich(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/points", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer good-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("X-Total-Pages", "1")
		_, _ = io.WriteString(w, `[{"latitude":42.3,"longitude":-71.12,"timestamp":1794424440,"ssid":"[wifi]"},{"latitude":42.301,"longitude":-71.12,"timestamp":1794424500,"bssid":"[ap]"}]`)
	})
	mux.HandleFunc("GET /api/v1/visits", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer good-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = io.WriteString(w, `[{"name":"Arnold Arboretum","status":"confirmed","started_at":"2026-11-11T19:14:00Z","ended_at":"2026-11-11T22:02:00Z","place":{"latitude":42.3,"longitude":-71.12}}]`)
	})
	mux.HandleFunc("GET /api/v1/tracks", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer good-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("X-Total-Pages", "1")
		_, _ = io.WriteString(w, `{"type":"FeatureCollection","features":[{"type":"Feature",
			"geometry":{"type":"LineString","coordinates":[[-71.12,42.3],[-71.121,42.301],[-71.122,42.302]]},
			"properties":{"id":7,"start_at":"2026-11-11T20:00:00Z","end_at":"2026-11-11T20:25:00Z","distance":2100,"dominant_mode":"cycling","color":"#6366F1"}}]}`)
	})
	return httptest.NewServer(mux)
}

type testEnv struct {
	mux   *http.ServeMux
	store *store.Store
	user  *store.User
	token string
}

func newTestEnv(ctx context.Context, t *testing.T, server *httptest.Server) *testEnv {
	t.Helper()
	testStore := teststore.NewTestingStore(ctx, t)
	t.Cleanup(func() { testStore.Close() })
	user, err := testStore.CreateUser(ctx, &store.User{Username: "will", Role: store.RoleUser, Email: "will@example.com", PasswordHash: "hash"})
	require.NoError(t, err)
	token, _, err := auth.GenerateAccessTokenV2(user.ID, user.Username, string(user.Role), string(user.RowStatus), user.PasswordHash, []byte(testSecret))
	require.NoError(t, err)
	service := NewService(testStore, testSecret)
	service.HTTPClient = server.Client()
	mux := http.NewServeMux()
	service.RegisterRoutes(mux)
	return &testEnv{mux: mux, store: testStore, user: user, token: token}
}

func (e *testEnv) request(method, path, body string, bearer bool) *httptest.ResponseRecorder {
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	request := httptest.NewRequest(method, path, reader)
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
	server := fakeDawarich(t)
	defer server.Close()
	env := newTestEnv(ctx, t, server)

	response := env.request(http.MethodGet, "/api/dawarich/connection", "", true)
	require.JSONEq(t, `{"configured":false,"url":""}`, response.Body.String())

	// A wrong key is explained and nothing is saved.
	response = env.request(http.MethodPut, "/api/dawarich/connection", `{"url":"`+server.URL+`","apiKey":"bad-key"}`, true)
	require.Equal(t, http.StatusBadGateway, response.Code)
	require.Contains(t, response.Body.String(), "Dawarich refused the API key")

	// Changes need a Bearer token, not just the cookie.
	response = env.request(http.MethodPut, "/api/dawarich/connection", `{"url":"`+server.URL+`","apiKey":"good-key"}`, false)
	require.Equal(t, http.StatusUnauthorized, response.Code)

	response = env.request(http.MethodPut, "/api/dawarich/connection", `{"url":"`+server.URL+`/api/v1","apiKey":"good-key"}`, true)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.JSONEq(t, `{"configured":true,"url":"`+server.URL+`"}`, response.Body.String())
	require.NotContains(t, response.Body.String(), "good-key")

	// An empty key keeps the saved one.
	response = env.request(http.MethodPut, "/api/dawarich/connection", `{"url":"`+server.URL+`","apiKey":""}`, true)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	saved := &Connection{}
	found, err := env.store.GetUserRecord(ctx, store.UserRecordDawarichConnection, env.user.ID, saved)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, "good-key", saved.APIKey)

	response = env.request(http.MethodDelete, "/api/dawarich/connection", "", true)
	require.Equal(t, http.StatusOK, response.Code)
	response = env.request(http.MethodGet, "/api/dawarich/points?start=2026-11-11T19:00:00Z&end=2026-11-11T22:00:00Z", "", true)
	require.Equal(t, http.StatusNotFound, response.Code)
}

func TestPointsAndVisitsCarryOnlyPositionAndTime(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	server := fakeDawarich(t)
	defer server.Close()
	env := newTestEnv(ctx, t, server)
	require.NoError(t, env.store.UpsertUserRecord(ctx, store.UserRecordDawarichConnection, env.user.ID, &Connection{URL: server.URL, APIKey: "good-key"}))

	response := env.request(http.MethodGet, "/api/dawarich/points?start=2026-11-11T19:00:00Z&end=2026-11-11T22:00:00Z", "", true)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.NotContains(t, response.Body.String(), "[wifi]")
	require.NotContains(t, response.Body.String(), "[ap]")
	require.Contains(t, response.Body.String(), `"lat":42.3`)
	require.Contains(t, response.Body.String(), `"distanceMeters":111.`)

	response = env.request(http.MethodGet, "/api/dawarich/visits?start=2026-11-11T19:00:00Z&end=2026-11-11T22:00:00Z", "", true)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.JSONEq(t, `{"visits":[{"name":"Arnold Arboretum","start":"2026-11-11T19:14:00Z","end":"2026-11-11T22:02:00Z","lat":42.3,"lon":-71.12}]}`, response.Body.String())

	for _, query := range []string{"start=2026-11-12T00:00:00Z&end=2026-11-11T00:00:00Z", "start=2026-10-01T00:00:00Z&end=2026-11-11T00:00:00Z", "start=today&end=now"} {
		response = env.request(http.MethodGet, "/api/dawarich/points?"+query, "", true)
		require.Equal(t, http.StatusBadRequest, response.Code, query)
	}
}

func TestTracksCarryTheLineAndMode(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	server := fakeDawarich(t)
	defer server.Close()
	env := newTestEnv(ctx, t, server)
	require.NoError(t, env.store.UpsertUserRecord(ctx, store.UserRecordDawarichConnection, env.user.ID, &Connection{URL: server.URL, APIKey: "good-key"}))

	response := env.request(http.MethodGet, "/api/dawarich/tracks?start=2026-11-11T05:00:00Z&end=2026-11-12T05:00:00Z", "", true)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.JSONEq(t, `{"supported":true,"tracks":[{"id":7,"start":"2026-11-11T20:00:00Z","end":"2026-11-11T20:25:00Z","distanceMeters":2100,"mode":"cycling",
		"points":[{"lat":42.3,"lon":-71.12},{"lat":42.301,"lon":-71.121},{"lat":42.302,"lon":-71.122}]}]}`, response.Body.String())

	response = env.request(http.MethodGet, "/api/dawarich/tracks?start=2026-11-11T05:00:00Z&end=2026-11-12T05:00:00Z", "", false)
	require.Equal(t, http.StatusUnauthorized, response.Code)
}

func TestTracksOnAnOlderDawarich(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	server := httptest.NewServer(http.NotFoundHandler())
	defer server.Close()
	env := newTestEnv(ctx, t, server)
	require.NoError(t, env.store.UpsertUserRecord(ctx, store.UserRecordDawarichConnection, env.user.ID, &Connection{URL: server.URL, APIKey: "good-key"}))

	response := env.request(http.MethodGet, "/api/dawarich/tracks?start=2026-11-11T05:00:00Z&end=2026-11-12T05:00:00Z", "", true)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.JSONEq(t, `{"supported":false,"tracks":[]}`, response.Body.String())
}

func TestThinKeepsEndsAndLimit(t *testing.T) {
	t.Parallel()
	points := make([]dawarichclient.Point, 5000)
	for i := range points {
		points[i] = dawarichclient.Point{Latitude: float64(i), Time: time.Unix(int64(i), 0)}
	}
	thinned := thin(points, 1500)
	require.Len(t, thinned, 1500)
	require.InDelta(t, 0, thinned[0].Latitude, 0)
	require.InDelta(t, 4999, thinned[1499].Latitude, 0)
	require.Len(t, thin(points[:10], 1500), 10)
}
