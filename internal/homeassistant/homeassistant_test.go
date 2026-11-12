package homeassistant

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/safehttp"
)

func fakeHomeAssistant(t *testing.T, sent *map[string]any) *httptest.Server {
	t.Helper()
	authorized := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bearer good-token" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			next(w, r)
		}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/", authorized(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"message":"API running."}`)
	}))
	mux.HandleFunc("GET /api/services", authorized(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `[{"domain":"light","services":{"turn_on":{}}},{"domain":"notify","services":{"mobile_app_tablet":{},"mobile_app_phone":{},"persistent_notification":{}}}]`)
	}))
	mux.HandleFunc("POST /api/services/notify/{name}", authorized(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "mobile_app_phone", r.PathValue("name"))
		require.NoError(t, json.NewDecoder(r.Body).Decode(sent))
		_, _ = io.WriteString(w, `[]`)
	}))
	return httptest.NewServer(mux)
}

func TestNormalizeURL(t *testing.T) {
	t.Parallel()
	got, err := NormalizeURL(" http://homeassistant.local:8123/api/ ")
	require.NoError(t, err)
	require.Equal(t, "http://homeassistant.local:8123", got)
	_, err = NormalizeURL("homeassistant.local")
	require.Error(t, err)
}

func TestCheckListAndNotify(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	sent := map[string]any{}
	server := fakeHomeAssistant(t, &sent)
	defer server.Close()
	client, err := NewClient(server.URL, "good-token", server.Client())
	require.NoError(t, err)

	require.NoError(t, client.Check(ctx))
	notifiers, err := client.Notifiers(ctx)
	require.NoError(t, err)
	require.Equal(t, []string{"notify.mobile_app_phone", "notify.mobile_app_tablet", "notify.persistent_notification"}, notifiers)

	require.NoError(t, client.Notify(ctx, "notify.mobile_app_phone", Notification{
		Title: "Your journal", Message: "Write a line?", URL: "https://notes.example.com/journal", ActionTitle: "Write now",
	}))
	require.Equal(t, "Your journal", sent["title"])
	require.Equal(t, "Write a line?", sent["message"])
	data, ok := sent["data"].(map[string]any)
	require.True(t, ok)
	require.Equal(t, "https://notes.example.com/journal", data["url"])
	require.Equal(t, "https://notes.example.com/journal", data["clickAction"])
	require.Equal(t, []any{map[string]any{"action": "URI", "title": "Write now", "uri": "https://notes.example.com/journal"}}, data["actions"])

	// Only notify services can be called.
	require.Error(t, client.Notify(ctx, "light.turn_on", Notification{Message: "x"}))
	require.Error(t, client.Notify(ctx, "notify.../../config", Notification{Message: "x"}))
}

func TestWrongTokenIsExplained(t *testing.T) {
	t.Parallel()
	sent := map[string]any{}
	server := fakeHomeAssistant(t, &sent)
	defer server.Close()
	client, err := NewClient(server.URL, "wrong-token", server.Client())
	require.NoError(t, err)

	err = client.Check(context.Background())
	require.ErrorIs(t, err, safehttp.ErrUnauthorized)
	require.Contains(t, Explain(err), "Home Assistant refused the access token")
}
