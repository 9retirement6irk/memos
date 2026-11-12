// Package safehttp is an HTTP client for servers a user names, such as their
// own photo, location or home-automation server. Those usually live on the
// home network, so private addresses stay reachable; the client refuses only
// the calling machine itself, link-local space and cloud metadata, follows a
// redirect only to the same host, and turns a failure into a plain sentence
// that says what to change.
package safehttp

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"

	"github.com/pkg/errors"
)

// maxRedirects bounds the same-host redirects followed for one request.
const maxRedirects = 5

// ErrBlockedAddress means the server address resolves only to the calling
// machine itself or to link-local space, which the client never dials.
var ErrBlockedAddress = errors.New("the address is not allowed")

// ErrUnauthorized means the server refused the key or token.
var ErrUnauthorized = errors.New("the key was refused")

// ErrUnexpectedAnswer means something answered, but not the expected API.
var ErrUnexpectedAnswer = errors.New("the server's answer is not the expected API")

// BlockedAddressError names the host and the blocked address it resolved to.
// It matches ErrBlockedAddress with errors.Is.
type BlockedAddressError struct {
	Host string
	IP   net.IP
}

func (e *BlockedAddressError) Error() string {
	return fmt.Sprintf("%q resolves to %s, which is not allowed", e.Host, e.IP)
}

// Is makes a BlockedAddressError match ErrBlockedAddress.
func (*BlockedAddressError) Is(target error) bool {
	return target == ErrBlockedAddress
}

// StatusError is an answer outside 2xx, other than a refused key.
type StatusError struct {
	Code int
}

func (e *StatusError) Error() string {
	return fmt.Sprintf("the server answered %d", e.Code)
}

// RedirectError is a redirect the client won't follow: to another host, or
// from https to http. Following it would hand the key to someone else or send
// it in the clear.
type RedirectError struct {
	Target string
}

func (e *RedirectError) Error() string {
	return fmt.Sprintf("the server redirects to %s", e.Target)
}

var blockedNetworks = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),      // "this network", dials the local host
	netip.MustParsePrefix("127.0.0.0/8"),    // IPv4 loopback
	netip.MustParsePrefix("169.254.0.0/16"), // link-local and cloud metadata
	netip.MustParsePrefix("::/128"),         // IPv6 unspecified, dials the local host
	netip.MustParsePrefix("::1/128"),        // IPv6 loopback
	netip.MustParsePrefix("fe80::/10"),      // IPv6 link-local
	netip.MustParsePrefix("fd00:ec2::/32"),  // cloud metadata over IPv6
}

// IsBlocked reports whether the client refuses to dial ip.
func IsBlocked(ip net.IP) bool {
	addr, ok := netip.AddrFromSlice(ip)
	if !ok {
		return true
	}
	addr = addr.Unmap()
	for _, network := range blockedNetworks {
		if network.Contains(addr) {
			return true
		}
	}
	return false
}

// DialContext resolves the host itself and dials the first allowed answer, so
// a name can't resolve to an allowed address for a check and a blocked one
// for the connection. It skips blocked answers and fails only when every
// answer is blocked.
func DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, errors.Errorf("invalid address %q", address)
	}
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to resolve %q", host)
	}
	dialer := &net.Dialer{}
	var dialErr error
	for _, ip := range ips {
		if IsBlocked(ip.IP) {
			if dialErr == nil {
				dialErr = &BlockedAddressError{Host: host, IP: ip.IP}
			}
			continue
		}
		dialHost := ip.IP.String()
		if ip.Zone != "" {
			dialHost += "%" + ip.Zone
		}
		conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(dialHost, port))
		if err == nil {
			return conn, nil
		}
		dialErr = err
	}
	var blocked *BlockedAddressError
	if errors.As(dialErr, &blocked) {
		return nil, dialErr
	}
	if dialErr != nil {
		return nil, errors.Wrapf(dialErr, "failed to connect to %q", host)
	}
	return nil, errors.Errorf("%q resolved to no addresses", host)
}

// CheckRedirect follows a redirect that stays on the same host name and does
// not drop from https to http, such as a reverse proxy sending http:// to
// https://. Clients send their key in a header, which Go carries along on a
// followed redirect, so anything else is refused.
func CheckRedirect(request *http.Request, via []*http.Request) error {
	if len(via) >= maxRedirects {
		return errors.Errorf("stopped after %d redirects", maxRedirects)
	}
	first := via[0].URL
	if !strings.EqualFold(request.URL.Hostname(), first.Hostname()) || (first.Scheme == "https" && request.URL.Scheme != "https") {
		return &RedirectError{Target: request.URL.Scheme + "://" + request.URL.Host}
	}
	return nil
}

// NewClient returns a client that dials with DialContext, follows redirects
// with CheckRedirect and gives up after timeout.
func NewClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout:       timeout,
		Transport:     &http.Transport{DialContext: DialContext, ResponseHeaderTimeout: timeout},
		CheckRedirect: CheckRedirect,
	}
}

// NormalizeBaseURL checks a server address a person typed and returns it
// without surrounding space, trailing slashes or any of the given path
// suffixes (such as "/api"). exampleHost, like "192.168.1.20:2283", is
// shown in the error as a plain-HTTP address.
func NormalizeBaseURL(rawURL, exampleHost string, trimSuffixes ...string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Host == "" {
		return "", errors.Errorf("the server address must be a full URL, like http://%s", exampleHost)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", errors.New("the server address must start with http:// or https://")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("the server address must not carry a user name, query or fragment")
	}
	path := strings.TrimRight(parsed.Path, "/")
	for _, suffix := range trimSuffixes {
		path = strings.TrimSuffix(path, suffix)
	}
	parsed.Path = path
	parsed.RawPath = ""
	return parsed.String(), nil
}

// MovedBase returns base with the scheme and host a followed redirect led to,
// so later calls skip the redirect; POSTs especially, which a 301 or 302
// would turn into GETs. It returns base unchanged when nothing moved.
func MovedBase(base string, asked, answered *url.URL) string {
	if answered == nil || (asked.Scheme == answered.Scheme && asked.Host == answered.Host) {
		return base
	}
	parsed, err := url.Parse(base)
	if err != nil {
		return base
	}
	parsed.Scheme, parsed.Host = answered.Scheme, answered.Host
	return parsed.String()
}
