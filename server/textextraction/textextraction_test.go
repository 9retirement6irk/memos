package textextraction

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
	teststore "github.com/usememos/memos/store/test"
)

const (
	testSecret = "test-secret"
	goodKey    = "test-claude-key-0001"
)

// fakeClaude answers the model list for goodKey and refuses any other key.
func fakeClaude(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/models", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != goodKey {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = io.WriteString(w, `{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`)
			return
		}
		_, _ = io.WriteString(w, `{"data":[{"id":"claude-haiku-5-5","type":"model"}]}`)
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

type testEnv struct {
	mux   *http.ServeMux
	store *store.Store
	admin string
	user  string
}

func newTestEnv(ctx context.Context, t *testing.T, claude *httptest.Server) *testEnv {
	t.Helper()
	testStore := teststore.NewTestingStore(ctx, t)
	t.Cleanup(func() { testStore.Close() })
	token := func(username string, role store.Role) string {
		user, err := testStore.CreateUser(ctx, &store.User{Username: username, Role: role, Email: username + "@example.com", PasswordHash: "hash"})
		require.NoError(t, err)
		token, _, err := auth.GenerateAccessTokenV2(user.ID, user.Username, string(user.Role), string(user.RowStatus), user.PasswordHash, []byte(testSecret))
		require.NoError(t, err)
		return token
	}
	service := NewService(testStore, testSecret)
	service.HTTPClient = claude.Client()
	mux := http.NewServeMux()
	service.RegisterRoutes(mux)
	return &testEnv{mux: mux, store: testStore, admin: token("admin", store.RoleAdmin), user: token("will", store.RoleUser)}
}

func (e *testEnv) do(method, path, body, token string) *httptest.ResponseRecorder {
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	request := httptest.NewRequest(method, path, reader)
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	recorder := httptest.NewRecorder()
	e.mux.ServeHTTP(recorder, request)
	return recorder
}

func decode(t *testing.T, recorder *httptest.ResponseRecorder) SettingsResponse {
	t.Helper()
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	response := SettingsResponse{}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &response))
	return response
}

func TestOnlyAdmins(t *testing.T) {
	ctx := context.Background()
	env := newTestEnv(ctx, t, fakeClaude(t))
	require.Equal(t, http.StatusUnauthorized, env.do(http.MethodGet, "/api/text-extraction/settings", "", "").Code)
	require.Equal(t, http.StatusForbidden, env.do(http.MethodGet, "/api/text-extraction/settings", "", env.user).Code)
	require.Equal(t, http.StatusForbidden, env.do(http.MethodPut, "/api/text-extraction/claude", `{"apiKey":"`+goodKey+`"}`, env.user).Code)
	require.Equal(t, http.StatusOK, env.do(http.MethodGet, "/api/text-extraction/settings", "", env.admin).Code)
}

func TestClaudeConnection(t *testing.T) {
	ctx := context.Background()
	claude := fakeClaude(t)
	env := newTestEnv(ctx, t, claude)

	// A refused key is not saved, and the error never repeats it.
	refused := env.do(http.MethodPut, "/api/text-extraction/claude", `{"endpoint":"`+claude.URL+`","apiKey":"wrong-key-0002"}`, env.admin)
	require.Equal(t, http.StatusBadGateway, refused.Code)
	require.Contains(t, refused.Body.String(), "rejected by Anthropic")
	require.NotContains(t, refused.Body.String(), "wrong-key-0002")
	require.False(t, decode(t, env.do(http.MethodGet, "/api/text-extraction/settings", "", env.admin)).Claude.Configured)

	// A working key is saved; the browser sees only a hint.
	saved := env.do(http.MethodPut, "/api/text-extraction/claude", `{"endpoint":"`+claude.URL+`/v1/","apiKey":"`+goodKey+`"}`, env.admin)
	require.NotContains(t, saved.Body.String(), goodKey)
	response := decode(t, saved)
	require.True(t, response.Claude.Configured)
	require.Equal(t, claude.URL, response.Claude.Endpoint)
	require.Equal(t, "test...0001", response.Claude.APIKeyHint)

	// An empty key keeps the saved one.
	require.True(t, decode(t, env.do(http.MethodPut, "/api/text-extraction/claude", `{"endpoint":"`+claude.URL+`"}`, env.admin)).Claude.Configured)

	stored := &Settings{}
	found, err := env.store.GetForkSetting(ctx, store.ForkSettingTextExtraction, stored)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, goodKey, stored.Claude.APIKey)
}

func TestChangesNeedABearerToken(t *testing.T) {
	ctx := context.Background()
	env := newTestEnv(ctx, t, fakeClaude(t))
	request := httptest.NewRequest(http.MethodPut, "/api/text-extraction/settings", strings.NewReader(`{"providerId":""}`))
	request.Header.Set("Cookie", "memos.access-token="+env.admin)
	recorder := httptest.NewRecorder()
	env.mux.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusUnauthorized, recorder.Code)
}

func TestChoosingTheProvider(t *testing.T) {
	ctx := context.Background()
	claude := fakeClaude(t)
	env := newTestEnv(ctx, t, claude)
	_, err := env.store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_AI,
		Value: &storepb.InstanceSetting_AiSetting{AiSetting: &storepb.InstanceAISetting{Providers: []*storepb.AIProviderConfig{
			{Id: "gemini-1", Title: "Gemini", Type: storepb.AIProviderType_GEMINI, ApiKey: "gemini-test-key"},
			{Id: "openai-1", Title: "OpenAI", Type: storepb.AIProviderType_OPENAI, ApiKey: "openai-test-key"},
		}}},
	})
	require.NoError(t, err)

	choose := func(body string) *httptest.ResponseRecorder {
		return env.do(http.MethodPut, "/api/text-extraction/settings", body, env.admin)
	}
	// Claude needs a connection first; OpenAI can't read images; unknown providers are refused.
	require.Equal(t, http.StatusBadRequest, choose(`{"providerId":"claude"}`).Code)
	require.Equal(t, http.StatusBadRequest, choose(`{"providerId":"openai-1"}`).Code)
	require.Equal(t, http.StatusBadRequest, choose(`{"providerId":"gone"}`).Code)
	require.Equal(t, http.StatusBadRequest, choose(`{"providerId":"gemini-1","model":"`+strings.Repeat("m", 257)+`"}`).Code)

	response := decode(t, choose(`{"providerId":"gemini-1","model":" gemini-2.5-flash "}`))
	require.Equal(t, "gemini-1", response.ProviderID)
	require.Equal(t, "gemini-2.5-flash", response.Model)

	decode(t, env.do(http.MethodPut, "/api/text-extraction/claude", `{"endpoint":"`+claude.URL+`","apiKey":"`+goodKey+`"}`, env.admin))
	require.Equal(t, ProviderClaude, decode(t, choose(`{"providerId":"claude","model":""}`)).ProviderID)

	// Removing Claude also stops extraction from using it.
	removed := decode(t, env.do(http.MethodDelete, "/api/text-extraction/claude", "", env.admin))
	require.False(t, removed.Claude.Configured)
	require.Empty(t, removed.ProviderID)
}

// The row is invisible to stock Memos' instance settings.
func TestStockSettingsIgnoreTheRow(t *testing.T) {
	ctx := context.Background()
	claude := fakeClaude(t)
	env := newTestEnv(ctx, t, claude)
	decode(t, env.do(http.MethodPut, "/api/text-extraction/claude", `{"endpoint":"`+claude.URL+`","apiKey":"`+goodKey+`"}`, env.admin))
	settings, err := env.store.ListInstanceSettings(ctx, &store.FindInstanceSetting{})
	require.NoError(t, err)
	for _, setting := range settings {
		require.NotEqual(t, storepb.InstanceSettingKey_INSTANCE_SETTING_KEY_UNSPECIFIED, setting.GetKey())
	}
}
