package journal

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
	teststore "github.com/usememos/memos/store/test"
)

const testSecret = "test-secret"

// fakeHomeAssistant records the notifications it is sent.
type fakeHomeAssistant struct {
	*httptest.Server
	mu   sync.Mutex
	sent []map[string]any
}

func newFakeHomeAssistant(t *testing.T) *fakeHomeAssistant {
	t.Helper()
	fake := &fakeHomeAssistant{}
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
		_, _ = io.WriteString(w, `[{"domain":"notify","services":{"mobile_app_phone":{}}}]`)
	}))
	mux.HandleFunc("POST /api/services/notify/{name}", authorized(func(w http.ResponseWriter, r *http.Request) {
		body := map[string]any{}
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		body["service"] = r.PathValue("name")
		fake.mu.Lock()
		fake.sent = append(fake.sent, body)
		fake.mu.Unlock()
		_, _ = io.WriteString(w, `[]`)
	}))
	fake.Server = httptest.NewServer(mux)
	return fake
}

func (f *fakeHomeAssistant) sentCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.sent)
}

type testEnv struct {
	service *Service
	mux     *http.ServeMux
	store   *store.Store
	user    *store.User
	token   string
}

func newTestEnv(ctx context.Context, t *testing.T, homeAssistant *fakeHomeAssistant) *testEnv {
	t.Helper()
	testStore := teststore.NewTestingStore(ctx, t)
	t.Cleanup(func() { testStore.Close() })
	user, err := testStore.CreateUser(ctx, &store.User{Username: "will", Role: store.RoleUser, Email: "will@example.com", PasswordHash: "hash"})
	require.NoError(t, err)
	token, _, err := auth.GenerateAccessTokenV2(user.ID, user.Username, string(user.Role), string(user.RowStatus), user.PasswordHash, []byte(testSecret))
	require.NoError(t, err)
	service := NewService(testStore, testSecret)
	service.HTTPClient = homeAssistant.Client()
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
	if bearer {
		request.Header.Set("Authorization", "Bearer "+e.token)
	}
	recorder := httptest.NewRecorder()
	e.mux.ServeHTTP(recorder, request)
	return recorder
}

func TestSettingsRoundTrip(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	homeAssistant := newFakeHomeAssistant(t)
	defer homeAssistant.Close()
	env := newTestEnv(ctx, t, homeAssistant)

	response := env.request(http.MethodGet, "/api/journal/settings", "", true)
	require.Equal(t, http.StatusOK, response.Code)
	require.JSONEq(t, `{}`, response.Body.String())

	settings := `{"space":"spaces/journal","openInJournalMode":true,"activities":[{"id":"work","label":"Work"}]}`
	response = env.request(http.MethodPut, "/api/journal/settings", settings, false)
	require.Equal(t, http.StatusUnauthorized, response.Code)
	response = env.request(http.MethodPut, "/api/journal/settings", settings, true)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	response = env.request(http.MethodGet, "/api/journal/settings", "", true)
	require.JSONEq(t, settings, response.Body.String())

	for _, body := range []string{`[]`, `"x"`, `{"space":"spaces/a\" || true"}`, `{"space":42}`, `{` + strings.Repeat(" ", maxSettingsBytes) + `}`} {
		response = env.request(http.MethodPut, "/api/journal/settings", body, true)
		require.GreaterOrEqual(t, response.Code, 400, body)
	}
}

func reminderBody(url, token string) string {
	return `{"enabled":true,"url":"` + url + `","token":"` + token + `","notifier":"notify.mobile_app_phone","time":"20:30","days":[0,1,2,3,4,5,6],` +
		`"timezone":"America/New_York","openUrl":"https://notes.example.com/journal","onlyIfNotWritten":true,"streakWarning":true}`
}

func TestReminderLifecycle(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	homeAssistant := newFakeHomeAssistant(t)
	defer homeAssistant.Close()
	env := newTestEnv(ctx, t, homeAssistant)

	response := env.request(http.MethodGet, "/api/journal/reminder", "", true)
	require.JSONEq(t, `{"configured":false,"enabled":false,"url":"","notifier":"","time":"","days":[],"timezone":"","openUrl":"","onlyIfNotWritten":false,"streakWarning":false}`, response.Body.String())

	// Notifiers can be listed before saving, with the token typed in.
	response = env.request(http.MethodPost, "/api/journal/reminder/notifiers", `{"url":"`+homeAssistant.URL+`","token":"good-token"}`, true)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.JSONEq(t, `{"notifiers":["notify.mobile_app_phone"]}`, response.Body.String())

	// A wrong token is explained and nothing is saved.
	response = env.request(http.MethodPut, "/api/journal/reminder", reminderBody(homeAssistant.URL, "bad-token"), true)
	require.Equal(t, http.StatusBadGateway, response.Code)
	require.Contains(t, response.Body.String(), "Home Assistant refused the access token")

	response = env.request(http.MethodPut, "/api/journal/reminder", reminderBody(homeAssistant.URL, "good-token"), true)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.NotContains(t, response.Body.String(), "good-token")

	// An empty token keeps the saved one.
	response = env.request(http.MethodPut, "/api/journal/reminder", reminderBody(homeAssistant.URL, ""), true)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	response = env.request(http.MethodPost, "/api/journal/reminder/test", "", true)
	require.Equal(t, http.StatusNoContent, response.Code, response.Body.String())
	require.Equal(t, 1, homeAssistant.sentCount())
	data, ok := homeAssistant.sent[0]["data"].(map[string]any)
	require.True(t, ok)
	require.Equal(t, "https://notes.example.com/journal", data["url"])
	require.Equal(t, "mobile_app_phone", homeAssistant.sent[0]["service"])

	for _, broken := range []string{
		strings.Replace(reminderBody(homeAssistant.URL, ""), `notify.mobile_app_phone`, `light.turn_on`, 1),
		strings.Replace(reminderBody(homeAssistant.URL, ""), `20:30`, `8:30pm`, 1),
		strings.Replace(reminderBody(homeAssistant.URL, ""), `[0,1,2,3,4,5,6]`, `[7]`, 1),
		strings.Replace(reminderBody(homeAssistant.URL, ""), `America/New_York`, `Mars/Olympus`, 1),
		strings.Replace(reminderBody(homeAssistant.URL, ""), `https://notes.example.com/journal`, `javascript:alert(1)`, 1),
	} {
		response = env.request(http.MethodPut, "/api/journal/reminder", broken, true)
		require.Equal(t, http.StatusBadRequest, response.Code, broken)
	}

	response = env.request(http.MethodDelete, "/api/journal/reminder", "", true)
	require.Equal(t, http.StatusOK, response.Code)
}

// addEntry adds a memo dated at the given time.
func addEntry(ctx context.Context, t *testing.T, env *testEnv, uid string, at time.Time) {
	t.Helper()
	memo, err := env.store.CreateMemo(ctx, &store.Memo{UID: uid, CreatorID: env.user.ID, Content: "entry", Visibility: store.Private})
	require.NoError(t, err)
	createdTs := at.Unix()
	require.NoError(t, env.store.UpdateMemo(ctx, &store.UpdateMemo{ID: memo.ID, CreatedTs: &createdTs}))
}

func TestDueReminderWarnsOfStreakOnceADay(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	homeAssistant := newFakeHomeAssistant(t)
	defer homeAssistant.Close()
	env := newTestEnv(ctx, t, homeAssistant)
	newYork, err := time.LoadLocation("America/New_York")
	require.NoError(t, err)

	// Entries on the three days before Thursday, November 12, none on it.
	for i, day := range []int{9, 10, 11} {
		addEntry(ctx, t, env, "entry"+string(rune('a'+i)), time.Date(2026, 11, day, 19, 0, 0, 0, newYork))
	}
	response := env.request(http.MethodPut, "/api/journal/reminder", reminderBody(homeAssistant.URL, "good-token"), true)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())

	// Before the time, nothing.
	env.service.Now = func() time.Time { return time.Date(2026, 11, 12, 20, 0, 0, 0, newYork) }
	env.service.SendDueReminders(ctx)
	require.Equal(t, 0, homeAssistant.sentCount())

	// At the time, the streak warning, once.
	env.service.Now = func() time.Time { return time.Date(2026, 11, 12, 20, 31, 0, 0, newYork) }
	env.service.SendDueReminders(ctx)
	env.service.SendDueReminders(ctx)
	require.Equal(t, 1, homeAssistant.sentCount())
	require.Equal(t, "Your 3-day journal streak ends tonight", homeAssistant.sent[0]["title"])

	// The next day, after writing, the "only if not written" reminder stays quiet.
	addEntry(ctx, t, env, "entryd", time.Date(2026, 11, 13, 9, 0, 0, 0, newYork))
	env.service.Now = func() time.Time { return time.Date(2026, 11, 13, 20, 45, 0, 0, newYork) }
	env.service.SendDueReminders(ctx)
	require.Equal(t, 1, homeAssistant.sentCount())

	// Far past the time, a missed reminder no longer goes.
	env.service.Now = func() time.Time { return time.Date(2026, 11, 14, 23, 59, 0, 0, newYork) }
	env.service.SendDueReminders(ctx)
	require.Equal(t, 1, homeAssistant.sentCount())
}

func TestStreakEnding(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 11, 12, 21, 0, 0, 0, time.UTC)
	days := map[string]bool{"2026-11-10": true, "2026-11-11": true, "2026-11-08": true}
	require.Equal(t, 2, streakEnding(days, now))
	days["2026-11-12"] = true
	require.Equal(t, 3, streakEnding(days, now))
	require.Equal(t, 0, streakEnding(map[string]bool{"2026-11-01": true}, now))
}
