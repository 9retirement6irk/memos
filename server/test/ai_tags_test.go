package test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	apipb "github.com/usememos/memos/proto/gen/api"
	"github.com/usememos/memos/proto/gen/api/apiconnect"
	"github.com/usememos/memos/server/textextraction"
	"github.com/usememos/memos/store"
)

func TestSuggestTags(t *testing.T) {
	inst := bootInstance(t.Context(), t, instanceOptions{instanceURL: "http://127.0.0.1"})
	inst.createAdmin(t)
	token := inst.signIn(t)
	const path = "/api/ai:suggestTags"
	draft := map[string]any{"content": "#already a bug", "candidateTags": []string{"already", "工作/会议", "two words", "bug", "code", "extra", "bug"}}

	code, _ := inst.do(t, http.MethodPost, path, "", draft)
	require.Equal(t, http.StatusUnauthorized, code)
	code, body := inst.do(t, http.MethodPost, path, token, draft)
	require.Contains(t, string(body), "text generation is not configured")
	require.NotEqual(t, http.StatusOK, code)

	var geminiOutput atomic.Value
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/models":
			_, _ = io.WriteString(w, `{"data":[]}`)
		case "/v1beta/models":
			_, _ = io.WriteString(w, `{"models":[{"name":"models/text-model"}]}`)
		case "/chat/completions":
			var request struct {
				Model    string
				Messages []struct{ Role, Content string }
			}
			assert.NoError(t, json.NewDecoder(r.Body).Decode(&request))
			assert.Equal(t, "text-model", request.Model)
			assert.Equal(t, "Bearer test-key", r.Header.Get("Authorization"))
			if assert.Len(t, request.Messages, 2) {
				assert.Equal(t, "system", request.Messages[0].Role)
				assert.JSONEq(t, `{"draft":"#already a bug","candidates":["工作/会议","bug","code","extra"]}`, request.Messages[1].Content)
			}
			_, _ = io.WriteString(w, `{"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"{\"tags\":[\"invented\",\"already\",\"bug\",\"bug\",\"工作/会议\",\"code\",\"extra\"],\"newTag\":\"debugging\"}"}}]}`)
		case "/v1beta/models/text-model:generateContent":
			assert.Equal(t, "test-key", r.Header.Get("x-goog-api-key"))
			output, err := json.Marshal(geminiOutput.Load())
			assert.NoError(t, err)
			_, _ = io.WriteString(w, `{"candidates":[{"finishReason":"STOP","content":{"parts":[{"text":`+string(output)+`}]}}]}`)
		case "/v1beta/models/invalid-output:generateContent":
			_, _ = io.WriteString(w, `{"candidates":[{"finishReason":"STOP","content":{"parts":[{"text":"bad JSON"}]}}]}`)
		default:
			t.Errorf("unexpected provider route %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer upstream.Close()

	configure := func(kind, model string) {
		t.Helper()
		code, body := inst.do(t, http.MethodPatch, "/api/instance/settings/AI", token, map[string]any{
			"aiSetting": map[string]any{
				"providers":      []map[string]string{{"id": "p", "type": kind, "title": "test", "apiKey": "test-key", "endpoint": upstream.URL}},
				"textGeneration": map[string]string{"providerId": "p", "model": model},
			},
		})
		require.Equal(t, http.StatusOK, code, "%s", body)
	}

	configure("OPENAI", "text-model")
	code, body = inst.do(t, http.MethodPost, path, token, draft)
	require.Equal(t, http.StatusOK, code, "%s", body)
	require.JSONEq(t, `{"tags":["bug","工作/会议","code"]}`, string(body))

	for _, invalid := range []map[string]any{
		{"content": "  ", "candidateTags": []string{"bug"}},
		{"content": strings.Repeat("a", 65537), "candidateTags": []string{"bug"}},
		{"content": "a", "candidateTags": make([]string, 65)},
	} {
		code, _ = inst.do(t, http.MethodPost, path, token, invalid)
		require.Equal(t, http.StatusBadRequest, code)
	}
	client := apiconnect.NewAIServiceClient(inst.client, inst.baseURL)
	suggest := func(content string, candidates ...string) (*connect.Response[apipb.SuggestTagsResponse], error) {
		req := connect.NewRequest(&apipb.SuggestTagsRequest{Content: content, CandidateTags: candidates})
		req.Header().Set("Authorization", "Bearer "+token)
		return client.SuggestTags(t.Context(), req)
	}

	configure("GEMINI", "text-model")
	for _, tc := range []struct {
		name, draft, output string
		candidates, want    []string
	}{
		{"reuse over new", "fixes", `{"tags":["code"],"newTag":"debugging"}`, []string{"code"}, []string{"code"}},
		{"empty vocabulary", "半马训练", `{"tags":[],"newTag":"跑步"}`, nil, []string{"跑步"}},
		{"unmatched vocabulary", "半马训练", `{"tags":[],"newTag":"跑步"}`, []string{"code"}, []string{"跑步"}},
		{"already in draft", "今天 #跑步", `{"tags":[],"newTag":"跑步"}`, nil, nil},
		{"no clear topic", "嗯", `{"tags":[]}`, nil, nil},
		{"invalid new tag", "半马训练", `{"tags":[],"newTag":"two words"}`, nil, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			geminiOutput.Store(tc.output)
			resp, err := suggest(tc.draft, tc.candidates...)
			require.NoError(t, err)
			require.Equal(t, tc.want, resp.Msg.Tags)
		})
	}
	configure("GEMINI", "invalid-output")
	_, err := suggest("fixes")
	require.Equal(t, connect.CodeUnavailable, connect.CodeOf(err))
}

// The fork's Claude connection answers tag suggestions when an admin chose it,
// with or without a stock text generation provider.
func TestSuggestTagsWithClaude(t *testing.T) {
	inst := bootInstance(t.Context(), t, instanceOptions{instanceURL: "http://127.0.0.1"})
	inst.createAdmin(t)
	token := inst.signIn(t)
	const path = "/api/ai:suggestTags"
	draft := map[string]any{"content": "a bug in the parser", "candidateTags": []string{"bug", "code"}}

	var asked atomic.Int32
	claude := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if !assert.Equal(t, "/v1/messages", r.URL.Path) {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		asked.Add(1)
		var request struct {
			Model    string
			System   string
			Messages []struct{ Role, Content string }
		}
		assert.NoError(t, json.NewDecoder(r.Body).Decode(&request))
		assert.Equal(t, "claude-test-model", request.Model)
		assert.Equal(t, "claude-test-key", r.Header.Get("x-api-key"))
		assert.NotEmpty(t, request.System)
		if assert.Len(t, request.Messages, 1) {
			assert.JSONEq(t, `{"draft":"a bug in the parser","candidates":["bug","code"]}`, request.Messages[0].Content)
		}
		_, _ = io.WriteString(w, `{"content":[{"type":"text","text":"{\"tags\":[\"bug\"]}"}],"stop_reason":"end_turn"}`)
	}))
	defer claude.Close()

	tagSuggestions := func() bool {
		t.Helper()
		code, body := inst.do(t, http.MethodGet, "/api/instance/profile", token, nil)
		require.Equal(t, http.StatusOK, code, "%s", body)
		var profile struct {
			AiFeatures struct {
				TagSuggestions bool `json:"tagSuggestions"`
			} `json:"aiFeatures"`
		}
		require.NoError(t, json.Unmarshal(body, &profile))
		return profile.AiFeatures.TagSuggestions
	}
	save := func(settings *textextraction.Settings) {
		t.Helper()
		require.NoError(t, inst.server.Store.UpsertForkSetting(t.Context(), store.ForkSettingTextExtraction, settings))
	}
	connection := &textextraction.ClaudeConnection{Endpoint: claude.URL, APIKey: "claude-test-key"}

	// Claude connected but not chosen for tags: nothing answers them.
	save(&textextraction.Settings{Claude: connection})
	require.False(t, tagSuggestions())
	code, body := inst.do(t, http.MethodPost, path, token, draft)
	require.NotEqual(t, http.StatusOK, code)
	require.Contains(t, string(body), "text generation is not configured")
	require.Zero(t, asked.Load())

	save(&textextraction.Settings{Claude: connection, TagSuggestionModel: "claude-test-model"})
	require.True(t, tagSuggestions())
	code, body = inst.do(t, http.MethodPost, path, token, draft)
	require.Equal(t, http.StatusOK, code, "%s", body)
	require.JSONEq(t, `{"tags":["bug"]}`, string(body))
	require.EqualValues(t, 1, asked.Load())

	// Chosen, Claude answers in place of a stock provider too.
	stock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/models" {
			_, _ = io.WriteString(w, `{"data":[]}`)
			return
		}
		t.Errorf("the stock provider was asked: %s", r.URL.Path)
		w.WriteHeader(http.StatusNotFound)
	}))
	defer stock.Close()
	code, body = inst.do(t, http.MethodPatch, "/api/instance/settings/AI", token, map[string]any{
		"aiSetting": map[string]any{
			"providers":      []map[string]string{{"id": "p", "type": "OPENAI", "title": "test", "apiKey": "test-key", "endpoint": stock.URL}},
			"textGeneration": map[string]string{"providerId": "p", "model": "text-model"},
		},
	})
	require.Equal(t, http.StatusOK, code, "%s", body)
	code, body = inst.do(t, http.MethodPost, path, token, draft)
	require.Equal(t, http.StatusOK, code, "%s", body)
	require.EqualValues(t, 2, asked.Load())
}
