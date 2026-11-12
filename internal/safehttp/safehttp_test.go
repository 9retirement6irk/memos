package safehttp

import (
	"context"
	"net"
	"net/http"
	"net/url"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestIsBlocked(t *testing.T) {
	t.Parallel()
	for _, ip := range []string{"127.0.0.1", "0.0.0.0", "169.254.169.254", "::1", "fe80::1", "::ffff:127.0.0.1"} {
		require.True(t, IsBlocked(net.ParseIP(ip)), ip)
	}
	// Home servers usually live on the home network, so private addresses stay reachable.
	for _, ip := range []string{"192.168.1.20", "10.0.0.5", "172.17.0.2", "100.100.1.1", "fd12:3456::1", "93.184.216.34"} {
		require.False(t, IsBlocked(net.ParseIP(ip)), ip)
	}
}

func TestCheckRedirect(t *testing.T) {
	t.Parallel()
	request := func(rawURL string) *http.Request {
		parsed, err := url.Parse(rawURL)
		require.NoError(t, err)
		return &http.Request{URL: parsed}
	}
	first := []*http.Request{request("http://immich.example.com/api/users/me")}
	require.NoError(t, CheckRedirect(request("https://immich.example.com/api/users/me"), first))
	require.NoError(t, CheckRedirect(request("http://IMMICH.example.com:2283/api/users/me"), first))

	var redirectError *RedirectError
	require.ErrorAs(t, CheckRedirect(request("https://photos.example.com/api/users/me"), first), &redirectError)
	secure := []*http.Request{request("https://immich.example.com/api/users/me")}
	require.ErrorAs(t, CheckRedirect(request("http://immich.example.com/api/users/me"), secure), &redirectError)

	many := make([]*http.Request, maxRedirects)
	for i := range many {
		many[i] = first[0]
	}
	require.ErrorContains(t, CheckRedirect(request("https://immich.example.com/"), many), "stopped after")
}

func TestSafeDialSkipsBlockedAnswers(t *testing.T) {
	t.Parallel()
	// localhost resolves only to loopback, so every answer is skipped and the error names one.
	_, err := DialContext(context.Background(), "tcp", "localhost:2283")
	var blocked *BlockedAddressError
	require.ErrorAs(t, err, &blocked)
	require.ErrorIs(t, err, ErrBlockedAddress)
	require.Equal(t, "localhost", blocked.Host)
	require.True(t, blocked.IP.IsLoopback())
}
