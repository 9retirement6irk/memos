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
	mux     *http.ServeMux
	store   *store.Store
	service *Service
	admin   string
	user    string
	adminID int32
	userID  int32
}

func newTestEnv(ctx context.Context, t *testing.T, claude *httptest.Server) *testEnv {
	t.Helper()
	testStore := teststore.NewTestingStore(ctx, t)
	t.Cleanup(func() { testStore.Close() })
	token := func(username string, role store.Role) (string, int32) {
		user, err := testStore.CreateUser(ctx, &store.User{Username: username, Role: role, Email: username + "@example.com", PasswordHash: "hash"})
		require.NoError(t, err)
		token, _, err := auth.GenerateAccessTokenV2(user.ID, user.Username, string(user.Role), string(user.RowStatus), user.PasswordHash, []byte(testSecret))
		require.NoError(t, err)
		return token, user.ID
	}
	service := NewService(testStore, testSecret)
	service.HTTPClient = claude.Client()
	mux := http.NewServeMux()
	service.RegisterRoutes(mux)
	env := &testEnv{mux: mux, store: testStore, service: service}
	env.admin, env.adminID = token("admin", store.RoleAdmin)
	env.user, env.userID = token("will", store.RoleUser)
	return env
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
	require.Equal(t, http.StatusForbidden, env.do(http.MethodPut, "/api/text-extraction/settings", `{"providerId":""}`, env.user).Code)
	require.Equal(t, http.StatusOK, env.do(http.MethodGet, "/api/text-extraction/settings", "", env.admin).Code)
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

// setProviders saves the instance's AI providers, as Settings > AI does.
func setProviders(ctx context.Context, t *testing.T, env *testEnv, providers ...*storepb.AIProviderConfig) {
	t.Helper()
	_, err := env.store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key:   storepb.InstanceSettingKey_AI,
		Value: &storepb.InstanceSetting_AiSetting{AiSetting: &storepb.InstanceAISetting{Providers: providers}},
	})
	require.NoError(t, err)
}

func TestChoosingTheProvider(t *testing.T) {
	ctx := context.Background()
	env := newTestEnv(ctx, t, fakeClaude(t))
	setProviders(ctx, t, env,
		&storepb.AIProviderConfig{Id: "gemini-1", Title: "Gemini", Type: storepb.AIProviderType_GEMINI, ApiKey: "gemini-test-key"},
		&storepb.AIProviderConfig{Id: "openai-1", Title: "OpenAI", Type: storepb.AIProviderType_OPENAI, ApiKey: "openai-test-key"},
		&storepb.AIProviderConfig{Id: "claude-1", Title: "Claude", Type: storepb.AIProviderType_ANTHROPIC, ApiKey: goodKey},
		&storepb.AIProviderConfig{Id: "proxy-1", Title: "Proxy", Type: storepb.AIProviderType_ANTHROPIC_COMPATIBLE, Endpoint: "https://claude.example.com", ApiKey: goodKey},
	)

	choose := func(body string) *httptest.ResponseRecorder {
		return env.do(http.MethodPut, "/api/text-extraction/settings", body, env.admin)
	}
	// OpenAI can't read images here; unknown providers, the old Claude connection's name among them, are refused.
	require.Equal(t, http.StatusBadRequest, choose(`{"providerId":"openai-1"}`).Code)
	require.Equal(t, http.StatusBadRequest, choose(`{"providerId":"gone"}`).Code)
	require.Equal(t, http.StatusBadRequest, choose(`{"providerId":"claude"}`).Code)
	require.Equal(t, http.StatusBadRequest, choose(`{"providerId":"gemini-1","model":"`+strings.Repeat("m", 257)+`"}`).Code)

	response := decode(t, choose(`{"providerId":"gemini-1","model":" gemini-2.5-flash "}`))
	require.Equal(t, "gemini-1", response.ProviderID)
	require.Equal(t, "gemini-2.5-flash", response.Model)
	require.Equal(t, "claude-1", decode(t, choose(`{"providerId":"claude-1","model":""}`)).ProviderID)
	require.Equal(t, "proxy-1", decode(t, choose(`{"providerId":"proxy-1"}`)).ProviderID)

	// The answer carries the choice and nothing of the provider.
	recorder := env.do(http.MethodGet, "/api/text-extraction/settings", "", env.admin)
	require.NotContains(t, recorder.Body.String(), goodKey)
	require.Empty(t, decode(t, choose(`{"providerId":""}`)).ProviderID)
}

// The row is invisible to stock Memos' instance settings.
func TestStockSettingsIgnoreTheRow(t *testing.T) {
	ctx := context.Background()
	env := newTestEnv(ctx, t, fakeClaude(t))
	decode(t, env.do(http.MethodPut, "/api/text-extraction/settings", `{"providerId":""}`, env.admin))
	settings, err := env.store.ListInstanceSettings(ctx, &store.FindInstanceSetting{})
	require.NoError(t, err)
	for _, setting := range settings {
		require.NotEqual(t, storepb.InstanceSettingKey_INSTANCE_SETTING_KEY_UNSPECIFIED, setting.GetKey())
	}
}
