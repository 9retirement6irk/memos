package immich

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// currentUserError asks server for the current user with client and returns the failure.
func currentUserError(t *testing.T, rawURL string, httpClient *http.Client) error {
	t.Helper()
	client, err := NewClient(rawURL, "good-key", httpClient)
	require.NoError(t, err)
	_, err = client.CurrentUser(context.Background())
	require.Error(t, err)
	return err
}

func TestExplain(t *testing.T) {
	t.Parallel()

	t.Run("refused key", func(t *testing.T) {
		t.Parallel()
		require.Contains(t, Explain(ErrUnauthorized), "refused the API key")
	})

	t.Run("the Memos server itself", func(t *testing.T) {
		t.Parallel()
		server := httptest.NewServer(http.NotFoundHandler())
		defer server.Close()
		message := Explain(currentUserError(t, server.URL, nil))
		require.Contains(t, message, "127.0.0.1 resolves to 127.0.0.1")
		require.Contains(t, message, "the Memos server itself")
	})

	t.Run("no Immich API at that path", func(t *testing.T) {
		t.Parallel()
		server := fakeImmich(t)
		defer server.Close()
		message := Explain(currentUserError(t, server.URL+"/photos", server.Client()))
		require.Contains(t, message, "not the Immich API")
	})

	t.Run("a web page instead of the API", func(t *testing.T) {
		t.Parallel()
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = io.WriteString(w, "<!doctype html><title>Router</title>")
		}))
		defer server.Close()
		require.Contains(t, Explain(currentUserError(t, server.URL, server.Client())), "it isn't Immich")
	})

	t.Run("server error", func(t *testing.T) {
		t.Parallel()
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusServiceUnavailable)
		}))
		defer server.Close()
		require.Contains(t, Explain(currentUserError(t, server.URL, server.Client())), "HTTP 503")
	})

	t.Run("unknown host name", func(t *testing.T) {
		t.Parallel()
		message := Explain(currentUserError(t, "http://immich.invalid:2283", nil))
		require.Contains(t, message, "couldn't find a server called immich.invalid")
	})

	t.Run("nothing listening", func(t *testing.T) {
		t.Parallel()
		server := httptest.NewServer(http.NotFoundHandler())
		httpClient := server.Client()
		closedURL := server.URL
		server.Close()
		message := Explain(currentUserError(t, closedURL, httpClient))
		require.Contains(t, message, "Nothing is listening at "+strings.TrimPrefix(closedURL, "http://"))
	})

	t.Run("https to a plain HTTP port", func(t *testing.T) {
		t.Parallel()
		server := httptest.NewServer(http.NotFoundHandler())
		defer server.Close()
		httpsURL := "https://" + strings.TrimPrefix(server.URL, "http://")
		require.Contains(t, Explain(currentUserError(t, httpsURL, server.Client())), "speaks plain HTTP")
	})

	t.Run("untrusted certificate", func(t *testing.T) {
		t.Parallel()
		server := httptest.NewTLSServer(http.NotFoundHandler())
		defer server.Close()
		require.Contains(t, Explain(currentUserError(t, server.URL, &http.Client{})), "doesn't trust the HTTPS certificate")
	})

	t.Run("no answer in time", func(t *testing.T) {
		t.Parallel()
		release := make(chan struct{})
		server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
			select {
			case <-release:
			case <-r.Context().Done():
			}
		}))
		defer server.Close()
		defer close(release)
		message := Explain(currentUserError(t, server.URL, &http.Client{Timeout: 50 * time.Millisecond}))
		require.Contains(t, message, "didn't answer in time")
	})
}

// redirectingClient is server's client with the package's redirect rule.
func redirectingClient(server *httptest.Server) *http.Client {
	httpClient := server.Client()
	httpClient.CheckRedirect = checkRedirect
	return httpClient
}

func TestClientFollowsRedirectOnSameHost(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	immich := fakeImmich(t)
	defer immich.Close()
	// A front door on another port of the same host, like a proxy sending http:// on to https://.
	frontDoor := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, immich.URL+r.URL.RequestURI(), http.StatusMovedPermanently)
	}))
	defer frontDoor.Close()

	client, err := NewClient(frontDoor.URL, "good-key", redirectingClient(immich))
	require.NoError(t, err)
	user, err := client.CurrentUser(ctx)
	require.NoError(t, err)
	require.Equal(t, "u1", user.ID)
	require.Equal(t, immich.URL, client.BaseURL())

	// A POST after the move goes straight to the new address; through the redirect it would turn into a GET.
	page, err := client.SearchPhotos(ctx, "", "")
	require.NoError(t, err)
	require.Len(t, page.Photos, 1)
}

func TestClientRefusesRedirectToAnotherHost(t *testing.T) {
	t.Parallel()
	var keySeen atomic.Bool
	elsewhere := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "" {
			keySeen.Store(true)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer elsewhere.Close()
	// Same machine, different host name: the key must not follow.
	target := strings.Replace(elsewhere.URL, "127.0.0.1", "localhost", 1)
	frontDoor := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target+r.URL.RequestURI(), http.StatusFound)
	}))
	defer frontDoor.Close()

	err := currentUserError(t, frontDoor.URL, redirectingClient(frontDoor))
	var redirectError *RedirectError
	require.ErrorAs(t, err, &redirectError)
	require.Equal(t, target, redirectError.Target)
	require.Contains(t, Explain(err), "redirects to "+target)
	require.False(t, keySeen.Load())
}

func TestCheckRedirect(t *testing.T) {
	t.Parallel()
	request := func(rawURL string) *http.Request {
		parsed, err := url.Parse(rawURL)
		require.NoError(t, err)
		return &http.Request{URL: parsed}
	}
	first := []*http.Request{request("http://immich.example.com/api/users/me")}
	require.NoError(t, checkRedirect(request("https://immich.example.com/api/users/me"), first))
	require.NoError(t, checkRedirect(request("http://IMMICH.example.com:2283/api/users/me"), first))

	var redirectError *RedirectError
	require.ErrorAs(t, checkRedirect(request("https://photos.example.com/api/users/me"), first), &redirectError)
	secure := []*http.Request{request("https://immich.example.com/api/users/me")}
	require.ErrorAs(t, checkRedirect(request("http://immich.example.com/api/users/me"), secure), &redirectError)

	many := make([]*http.Request, maxRedirects)
	for i := range many {
		many[i] = first[0]
	}
	require.ErrorContains(t, checkRedirect(request("https://immich.example.com/"), many), "stopped after")
}

func TestSafeDialSkipsBlockedAnswers(t *testing.T) {
	t.Parallel()
	// localhost resolves only to loopback, so every answer is skipped and the error names one.
	_, err := safeDialContext(context.Background(), "tcp", "localhost:2283")
	var blocked *BlockedAddressError
	require.ErrorAs(t, err, &blocked)
	require.ErrorIs(t, err, ErrBlockedAddress)
	require.Equal(t, "localhost", blocked.Host)
	require.True(t, blocked.IP.IsLoopback())
}
