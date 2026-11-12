package dawarich

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/safehttp"
)

func TestNormalizeURL(t *testing.T) {
	t.Parallel()
	for input, want := range map[string]string{
		"http://dawarich.local:3000":          "http://dawarich.local:3000",
		"https://where.example.com/":          "https://where.example.com",
		"https://where.example.com/api/v1/":   "https://where.example.com",
		"  http://192.168.1.20:3000/api  ":    "http://192.168.1.20:3000",
		"https://example.com/dawarich/api/v1": "https://example.com/dawarich",
	} {
		got, err := NormalizeURL(input)
		require.NoError(t, err, input)
		require.Equal(t, want, got, input)
	}
	for _, input := range []string{"", "dawarich.local", "ftp://dawarich.local", "http://user:pass@dawarich.local"} {
		_, err := NormalizeURL(input)
		require.Error(t, err, input)
	}
}

// fakeDawarich serves points over two pages and visits. bearerOnly=false makes
// it refuse the Bearer token for points, as servers that want api_key do.
func fakeDawarich(t *testing.T, bearerOnly bool) *httptest.Server {
	t.Helper()
	authorized := func(r *http.Request, allowQuery bool) bool {
		if r.Header.Get("Authorization") == "Bearer good-key" {
			return true
		}
		return allowQuery && r.URL.Query().Get("api_key") == "good-key"
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/points", func(w http.ResponseWriter, r *http.Request) {
		if bearerOnly && !authorized(r, false) || !bearerOnly && r.URL.Query().Get("api_key") != "good-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		require.Equal(t, "2026-11-11T19:00:00Z", r.URL.Query().Get("start_at"))
		require.Equal(t, "2026-11-11T22:00:00Z", r.URL.Query().Get("end_at"))
		require.Equal(t, "asc", r.URL.Query().Get("order"))
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		w.Header().Set("X-Total-Pages", "2")
		if page == 1 {
			// The Wi-Fi name and battery are there but never read.
			_, _ = io.WriteString(w, `[{"latitude":42.30,"longitude":-71.12,"timestamp":1794424440,"ssid":"[wifi]","battery":80},{"latitude":"42.31","longitude":"-71.13","timestamp":1794424500},{"latitude":null,"longitude":-71.1,"timestamp":1794424560}]`)
			return
		}
		_, _ = io.WriteString(w, `[{"latitude":42.32,"longitude":-71.14,"timestamp":1794424620}]`)
	})
	mux.HandleFunc("GET /api/v1/visits", func(w http.ResponseWriter, r *http.Request) {
		if !authorized(r, true) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = io.WriteString(w, `[
			{"name":"Arnold Arboretum","status":"confirmed","started_at":"2026-11-11T19:14:00Z","ended_at":"2026-11-11T22:02:00Z","place":{"latitude":42.30,"longitude":-71.12},"center":null},
			{"name":"","display_name":"Home","status":"suggested","started_at":"2026-11-11T23:00:00Z","ended_at":"2026-11-12T08:00:00Z","place":null,"center":{"latitude":42.31,"longitude":-71.11}},
			{"name":"Wrong","status":"declined","started_at":"2026-11-11T20:00:00Z","ended_at":"2026-11-11T21:00:00Z"}
		]`)
	})
	return httptest.NewServer(mux)
}

var (
	rangeStart = time.Date(2026, 11, 11, 19, 0, 0, 0, time.UTC)
	rangeEnd   = time.Date(2026, 11, 11, 22, 0, 0, 0, time.UTC)
)

func TestPointsKeepOnlyPositionAndTime(t *testing.T) {
	t.Parallel()
	server := fakeDawarich(t, true)
	defer server.Close()
	client, err := NewClient(server.URL, "good-key", server.Client())
	require.NoError(t, err)

	points, err := client.Points(context.Background(), rangeStart, rangeEnd)
	require.NoError(t, err)
	require.Equal(t, []Point{
		{Latitude: 42.30, Longitude: -71.12, Time: time.Unix(1794424440, 0).UTC()},
		{Latitude: 42.31, Longitude: -71.13, Time: time.Unix(1794424500, 0).UTC()},
		{Latitude: 42.32, Longitude: -71.14, Time: time.Unix(1794424620, 0).UTC()},
	}, points)

	_, err = client.Points(context.Background(), rangeEnd, rangeStart)
	require.ErrorContains(t, err, "time range is empty")
}

func TestPointsFallBackToTheKeyParameter(t *testing.T) {
	t.Parallel()
	server := fakeDawarich(t, false)
	defer server.Close()
	client, err := NewClient(server.URL, "good-key", server.Client())
	require.NoError(t, err)

	points, err := client.Points(context.Background(), rangeStart, rangeEnd)
	require.NoError(t, err)
	require.Len(t, points, 3)
	require.True(t, client.keyInQuery)
}

func TestVisitsSkipDeclinedAndFindAPosition(t *testing.T) {
	t.Parallel()
	server := fakeDawarich(t, true)
	defer server.Close()
	client, err := NewClient(server.URL, "good-key", server.Client())
	require.NoError(t, err)

	visits, err := client.Visits(context.Background(), rangeStart, rangeEnd)
	require.NoError(t, err)
	require.Len(t, visits, 2)
	require.Equal(t, "Arnold Arboretum", visits[0].Name)
	require.InDelta(t, 42.30, *visits[0].Latitude, 0.0001)
	require.Equal(t, "Home", visits[1].Name)
	require.InDelta(t, -71.11, *visits[1].Longitude, 0.0001)
}

func TestWrongKeyIsExplained(t *testing.T) {
	t.Parallel()
	server := fakeDawarich(t, true)
	defer server.Close()
	client, err := NewClient(server.URL, "wrong-key", server.Client())
	require.NoError(t, err)

	err = client.Check(context.Background())
	require.ErrorIs(t, err, safehttp.ErrUnauthorized)
	require.Contains(t, Explain(err), "Dawarich refused the API key")
	require.NotContains(t, Explain(err), "wrong-key")
}

func TestKeyNeverInAFailureMessage(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.NotFoundHandler())
	httpClient := server.Client()
	closedURL := server.URL
	server.Close()

	client, err := NewClient(closedURL, "secret-key", httpClient)
	require.NoError(t, err)
	client.keyInQuery = true
	_, err = client.Points(context.Background(), rangeStart, rangeEnd)
	require.Error(t, err)
	require.NotContains(t, err.Error(), "secret-key")
	require.NotContains(t, Explain(err), "secret-key")
}
