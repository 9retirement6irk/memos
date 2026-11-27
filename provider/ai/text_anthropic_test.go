package ai

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

// Claude answers tag suggestions through the same SuggestTags call as the stock providers.
func TestSuggestTagsWithClaude(t *testing.T) {
	answer := "```json\n{\"tags\":[\"work\",\"invented\"],\"newTag\":\"\"}\n```"
	status := http.StatusOK
	var got struct {
		Model    string `json:"model"`
		System   string `json:"system"`
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/v1/messages", r.URL.Path)
		require.Equal(t, "test-key", r.Header.Get("x-api-key"))
		require.NoError(t, json.NewDecoder(r.Body).Decode(&got))
		if status != http.StatusOK {
			w.WriteHeader(status)
			_, _ = io.WriteString(w, `{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`)
			return
		}
		body, err := json.Marshal(map[string]any{
			"content":     []map[string]string{{"type": "text", "text": answer}},
			"stop_reason": "end_turn",
		})
		require.NoError(t, err)
		_, _ = w.Write(body)
	}))
	defer server.Close()
	provider := ProviderConfig{ID: "claude", Title: "Claude", Type: ProviderAnthropic, Endpoint: server.URL, APIKey: "test-key"}

	// The answer came in a code fence; only the candidates it names are kept.
	tags, err := SuggestTags(t.Context(), provider, "claude-haiku-5-5", "a meeting about the launch", []string{"work", "home"})
	require.NoError(t, err)
	require.Equal(t, []string{"work"}, tags)
	require.Equal(t, "claude-haiku-5-5", got.Model)
	require.Contains(t, got.System, `"tags" array`)
	require.Len(t, got.Messages, 1)
	require.JSONEq(t, `{"draft":"a meeting about the launch","candidates":["work","home"]}`, got.Messages[0].Content)

	answer = `Here is the tag: {"tags":[],"newTag":"launch"}`
	tags, err = SuggestTags(t.Context(), provider, "claude-haiku-5-5", "a meeting about the launch", nil)
	require.NoError(t, err)
	require.Equal(t, []string{"launch"}, tags)

	// Words without a JSON object are an unusable answer.
	answer = "I can't think of a tag."
	_, err = SuggestTags(t.Context(), provider, "claude-haiku-5-5", "a draft", nil)
	require.ErrorIs(t, err, ErrUnusableResponse)

	// A rejected key is the administrator's to fix, and Anthropic's own words stay out of the failure.
	status = http.StatusUnauthorized
	_, err = SuggestTags(t.Context(), provider, "claude-haiku-5-5", "a draft", nil)
	require.Error(t, err)
	require.Equal(t, Failure{Kind: FailureAuth, Status: http.StatusUnauthorized}, ClassifyFailure(err))
}

func TestJSONObject(t *testing.T) {
	for input, want := range map[string]string{
		`{"tags":[]}`:                      `{"tags":[]}`,
		"```json\n{\"tags\":[\"a\"]}\n```": `{"tags":["a"]}`,
		`Sure: {"a":{"b":1}} done`:         `{"a":{"b":1}}`,
		"no object here":                   "no object here",
		"} backwards {":                    "} backwards {",
	} {
		require.Equal(t, want, jsonObject(input), input)
	}
}
