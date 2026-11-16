package geminivision

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

const testKey = "test-gemini-key-not-real"

func TestNormalizeEndpoint(t *testing.T) {
	for raw, want := range map[string]string{
		"": DefaultEndpoint,
		"https://generativelanguage.googleapis.com/v1beta/": DefaultEndpoint,
		"https://generativelanguage.googleapis.com":         DefaultEndpoint,
		"https://proxy.example.com/gemini/v1":               "https://proxy.example.com/gemini/v1",
	} {
		got, err := NormalizeEndpoint(raw)
		require.NoError(t, err, raw)
		require.Equal(t, want, got, raw)
	}
	for _, raw := range []string{"generativelanguage.googleapis.com", "https://user:pw@example.com", "https://example.com/?key=1"} {
		_, err := NormalizeEndpoint(raw)
		require.Error(t, err, raw)
	}
}

func TestReadText(t *testing.T) {
	var got struct {
		Contents []struct {
			Role  string `json:"role"`
			Parts []struct {
				Text       string `json:"text"`
				InlineData *struct {
					MimeType string `json:"mime_type"`
					Data     string `json:"data"`
				} `json:"inline_data"`
			} `json:"parts"`
		} `json:"contents"`
		GenerationConfig struct {
			MaxOutputTokens int `json:"maxOutputTokens"`
		} `json:"generationConfig"`
	}
	var path string
	answer := `{"candidates":[{"content":{"parts":[{"text":"thinking","thought":true},{"text":" Line one\nLine two \n"}]},"finishReason":"STOP"}]}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodPost, r.Method)
		require.Equal(t, testKey, r.Header.Get("x-goog-api-key"))
		require.Empty(t, r.URL.Query().Get("key"))
		path = r.URL.Path
		require.NoError(t, json.NewDecoder(r.Body).Decode(&got))
		_, _ = w.Write([]byte(answer))
	}))
	defer server.Close()
	client, err := New(server.URL, testKey, server.Client())
	require.NoError(t, err)
	image := []Image{{MediaType: "image/png", Data: []byte("png-1")}}

	result, err := client.ReadText(context.Background(), TextRequest{Model: "models/gemini-2.5-flash", Instructions: "Transcribe.", Images: image, MaxTokens: 4096})
	require.NoError(t, err)
	require.Equal(t, "/v1beta/models/gemini-2.5-flash:generateContent", path)
	require.Equal(t, "Line one\nLine two", result.Text)
	require.False(t, result.Truncated)
	require.Len(t, got.Contents, 1)
	require.Equal(t, "user", got.Contents[0].Role)
	parts := got.Contents[0].Parts
	require.Len(t, parts, 2)
	require.NotNil(t, parts[0].InlineData)
	require.Equal(t, "image/png", parts[0].InlineData.MimeType)
	require.Equal(t, base64.StdEncoding.EncodeToString([]byte("png-1")), parts[0].InlineData.Data)
	require.Equal(t, "Transcribe.", parts[1].Text)
	require.Equal(t, 4096, got.GenerationConfig.MaxOutputTokens)

	answer = `{"candidates":[{"content":{"parts":[{"text":"Partial"}]},"finishReason":"MAX_TOKENS"}]}`
	result, err = client.ReadText(context.Background(), TextRequest{Model: "m", Images: image})
	require.NoError(t, err)
	require.True(t, result.Truncated)

	answer = `{"candidates":[{"content":{"parts":[]},"finishReason":"RECITATION"}]}`
	_, err = client.ReadText(context.Background(), TextRequest{Model: "m", Images: image})
	require.ErrorIs(t, err, ErrBlocked)
	require.Contains(t, err.Error(), "recitation")

	answer = `{"promptFeedback":{"blockReason":"SAFETY"}}`
	_, err = client.ReadText(context.Background(), TextRequest{Model: "m", Images: image})
	require.ErrorIs(t, err, ErrBlocked)

	answer = `{"candidates":[]}`
	result, err = client.ReadText(context.Background(), TextRequest{Model: "m", Images: image})
	require.NoError(t, err)
	require.Empty(t, result.Text)
}

func TestReadTextErrors(t *testing.T) {
	status, body := http.StatusBadRequest, `{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	defer server.Close()
	client, err := New(server.URL, testKey, server.Client())
	require.NoError(t, err)
	image := []Image{{MediaType: "image/png", Data: []byte("x")}}

	_, err = client.ReadText(context.Background(), TextRequest{Model: "m", Images: image})
	require.ErrorIs(t, err, ErrBadRequest)
	require.Contains(t, err.Error(), "API key not valid")
	require.NotContains(t, err.Error(), testKey)

	for code, want := range map[int]error{
		http.StatusForbidden:          ErrUnauthorized,
		http.StatusNotFound:           ErrNotFound,
		http.StatusTooManyRequests:    ErrRateLimited,
		http.StatusServiceUnavailable: ErrOverloaded,
	} {
		status, body = code, ""
		_, err = client.ReadText(context.Background(), TextRequest{Model: "m", Images: image})
		require.ErrorIs(t, err, want, code)
	}

	_, err = New(server.URL, " ", nil)
	require.Error(t, err)
	_, err = client.ReadText(context.Background(), TextRequest{Model: "m"})
	require.Error(t, err)
}
