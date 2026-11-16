package anthropic

import (
	"context"
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
