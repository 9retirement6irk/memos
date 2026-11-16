package anthropic

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pkg/errors"
	"github.com/stretchr/testify/require"
)

const testKey = "test-key-not-real"

func TestNormalizeEndpoint(t *testing.T) {
	for raw, want := range map[string]string{
		"":                                 DefaultEndpoint,
		"  ":                               DefaultEndpoint,
		"https://api.anthropic.com/":       "https://api.anthropic.com",
		"https://api.anthropic.com/v1":     "https://api.anthropic.com",
		"https://proxy.example.com/claude": "https://proxy.example.com/claude",
	} {
		got, err := NormalizeEndpoint(raw)
		require.NoError(t, err, raw)
		require.Equal(t, want, got, raw)
	}
	for _, raw := range []string{"api.anthropic.com", "ftp://example.com", "https://user:pw@example.com", "https://example.com/?a=1"} {
		_, err := NormalizeEndpoint(raw)
		require.Error(t, err, raw)
	}
}

func TestCheck(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/v1/models", r.URL.Path)
		require.Equal(t, "1", r.URL.Query().Get("limit"))
		require.Equal(t, apiVersion, r.Header.Get("anthropic-version"))
		if r.Header.Get("x-api-key") != testKey {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"claude-haiku-5-5","type":"model"}],"has_more":true}`))
	}))
	defer server.Close()

	client, err := New(server.URL+"/v1/", testKey, server.Client())
	require.NoError(t, err)
	require.Equal(t, server.URL, client.Endpoint())
	require.NoError(t, client.Check(context.Background()))

	wrong, err := New(server.URL, "another-key", server.Client())
	require.NoError(t, err)
	err = wrong.Check(context.Background())
	require.ErrorIs(t, err, ErrUnauthorized)
	require.Contains(t, err.Error(), "invalid x-api-key")
	require.NotContains(t, err.Error(), "another-key")
}

func TestCheckMapsStatuses(t *testing.T) {
	for status, want := range map[int]error{
		http.StatusForbidden:       ErrForbidden,
		http.StatusNotFound:        ErrNotFound,
		http.StatusTooManyRequests: ErrRateLimited,
		529:                        ErrOverloaded,
	} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(status)
		}))
		client, err := New(server.URL, testKey, server.Client())
		require.NoError(t, err)
		require.True(t, errors.Is(client.Check(context.Background()), want), status)
		server.Close()
	}
}

func TestCheckRejectsAnotherAPI(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("<html>not an API</html>"))
	}))
	defer server.Close()
	client, err := New(server.URL, testKey, server.Client())
	require.NoError(t, err)
	require.ErrorIs(t, client.Check(context.Background()), ErrNotFound)
}

func TestNewNeedsKey(t *testing.T) {
	_, err := New("", "  ", nil)
	require.Error(t, err)
	require.True(t, strings.Contains(err.Error(), "API key"))
}

func TestReadText(t *testing.T) {
	var got struct {
		Model     string `json:"model"`
		MaxTokens int    `json:"max_tokens"`
		Messages  []struct {
			Role    string `json:"role"`
			Content []struct {
				Type   string `json:"type"`
				Text   string `json:"text"`
				Source struct {
					Type      string `json:"type"`
					MediaType string `json:"media_type"`
					Data      string `json:"data"`
				} `json:"source"`
			} `json:"content"`
		} `json:"messages"`
	}
	answer := `{"content":[{"type":"text","text":"  Line one\nLine two \n"}],"stop_reason":"end_turn"}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodPost, r.Method)
		require.Equal(t, "/v1/messages", r.URL.Path)
		require.Equal(t, testKey, r.Header.Get("x-api-key"))
		require.Equal(t, "application/json", r.Header.Get("content-type"))
		require.NoError(t, json.NewDecoder(r.Body).Decode(&got))
		_, _ = w.Write([]byte(answer))
	}))
	defer server.Close()
	client, err := New(server.URL, testKey, server.Client())
	require.NoError(t, err)

	result, err := client.ReadText(context.Background(), TextRequest{
		Model:        "claude-haiku-5-5",
		Instructions: "Transcribe.",
		Images:       []Image{{MediaType: "image/png", Data: []byte("png-1")}, {MediaType: "image/jpeg", Data: []byte("jpg-2")}},
	})
	require.NoError(t, err)
	require.Equal(t, "Line one\nLine two", result.Text)
	require.False(t, result.Truncated)
	require.Equal(t, "claude-haiku-5-5", got.Model)
	require.Equal(t, 8192, got.MaxTokens)
	require.Len(t, got.Messages, 1)
	require.Equal(t, "user", got.Messages[0].Role)
	content := got.Messages[0].Content
	require.Len(t, content, 3)
	require.Equal(t, "image", content[0].Type)
	require.Equal(t, "base64", content[0].Source.Type)
	require.Equal(t, "image/png", content[0].Source.MediaType)
	require.Equal(t, base64.StdEncoding.EncodeToString([]byte("png-1")), content[0].Source.Data)
	require.Equal(t, "image/jpeg", content[1].Source.MediaType)
	require.Equal(t, "text", content[2].Type)
	require.Equal(t, "Transcribe.", content[2].Text)

	answer = `{"content":[{"type":"text","text":"Partial"}],"stop_reason":"max_tokens"}`
	result, err = client.ReadText(context.Background(), TextRequest{Model: "m", Images: []Image{{MediaType: "image/png", Data: []byte("x")}}})
	require.NoError(t, err)
	require.True(t, result.Truncated)

	answer = `{"content":[],"stop_reason":"refusal"}`
	_, err = client.ReadText(context.Background(), TextRequest{Model: "m", Images: []Image{{MediaType: "image/png", Data: []byte("x")}}})
	require.ErrorIs(t, err, ErrRefused)

	_, err = client.ReadText(context.Background(), TextRequest{Model: "m"})
	require.Error(t, err)
}

func TestReadTextBadRequest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"type":"error","error":{"type":"invalid_request_error","message":"image exceeds 5 MB maximum"}}`))
	}))
	defer server.Close()
	client, err := New(server.URL, testKey, server.Client())
	require.NoError(t, err)
	_, err = client.ReadText(context.Background(), TextRequest{Model: "m", Images: []Image{{MediaType: "image/png", Data: []byte("x")}}})
	require.ErrorIs(t, err, ErrBadRequest)
	require.Contains(t, err.Error(), "image exceeds 5 MB maximum")
}
