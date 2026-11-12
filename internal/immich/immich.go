// Package immich is a small client for the REST API of an Immich photo server
// (https://immich.app): it checks an API key, lists albums and photos, and
// opens a photo's thumbnail or original file.
//
// Immich usually runs on the same home network as whatever calls it, so the
// client may reach private addresses. It refuses loopback, link-local (cloud
// metadata) and "this network" addresses, follows a redirect only to the same
// host (so the API key never leaves it), and only ever calls the fixed API
// paths below.
package immich

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/pkg/errors"
)

// PageSize is how many photos one page of SearchPhotos returns.
const PageSize = 60

const (
	requestTimeout = 30 * time.Second
	// maxJSONBytes bounds a JSON answer; a page of 60 assets is far smaller.
	maxJSONBytes = 8 << 20
)

// ErrUnauthorized means the server refused the API key.
var ErrUnauthorized = errors.New("immich: the API key was refused")

// ErrBlockedAddress means the server address resolves only to the calling
// machine itself or to link-local space, which the client never dials.
var ErrBlockedAddress = errors.New("immich: the address is not allowed")

// BlockedAddressError names the host and the blocked address it resolved to.
// It matches ErrBlockedAddress with errors.Is.
type BlockedAddressError struct {
	Host string
	IP   net.IP
}

func (e *BlockedAddressError) Error() string {
	return fmt.Sprintf("immich: %q resolves to %s, which is not allowed", e.Host, e.IP)
}

// Is makes a BlockedAddressError match ErrBlockedAddress.
func (*BlockedAddressError) Is(target error) bool {
	return target == ErrBlockedAddress
}

// ErrNotImmich means something answered, but not with an Immich API answer.
var ErrNotImmich = errors.New("immich: the server's answer is not an Immich API answer")

// maxRedirects bounds the same-host redirects followed for one request.
const maxRedirects = 5

// StatusError is an answer outside 2xx (other than a refused key).
type StatusError struct {
	Code int
}

func (e *StatusError) Error() string {
	return fmt.Sprintf("immich: the server answered %d", e.Code)
}

// RedirectError is a redirect the client won't follow: to another host, or
// from https to http. Following it would hand the API key to someone else or
// send it in the clear.
type RedirectError struct {
	Target string
}

func (e *RedirectError) Error() string {
	return fmt.Sprintf("immich: the server redirects to %s", e.Target)
}

// assetIDPattern is an Immich asset or album ID: a UUID.
var assetIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// IsID reports whether value is an Immich asset or album ID.
func IsID(value string) bool {
	return assetIDPattern.MatchString(value)
}

// blockedNetworks are never dialed: they reach the calling machine itself or
// the cloud metadata service, not an Immich server on the network.
var blockedNetworks = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),      // "this network", dials the local host
	netip.MustParsePrefix("127.0.0.0/8"),    // IPv4 loopback
	netip.MustParsePrefix("169.254.0.0/16"), // link-local and cloud metadata
	netip.MustParsePrefix("::/128"),         // IPv6 unspecified, dials the local host
	netip.MustParsePrefix("::1/128"),        // IPv6 loopback
	netip.MustParsePrefix("fe80::/10"),      // IPv6 link-local
	netip.MustParsePrefix("fd00:ec2::/32"),  // cloud metadata over IPv6
}

func isBlocked(ip net.IP) bool {
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

// safeDialContext resolves the host, refuses blocked addresses, and dials the
// checked address itself, so DNS can't be rebound between check and connect.
func safeDialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, errors.Errorf("immich: invalid address %q", address)
	}
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, errors.Wrapf(err, "immich: failed to resolve %q", host)
	}
	dialer := &net.Dialer{}
	var dialErr error
	for _, ip := range ips {
		// Skip a blocked answer and try the rest; fail only if every answer is blocked.
		if isBlocked(ip.IP) {
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
		return nil, errors.Wrapf(dialErr, "immich: failed to connect to %q", host)
	}
	return nil, errors.Errorf("immich: %q resolved to no addresses", host)
}

// NewHTTPClient returns the HTTP client the package uses by default: it
// refuses blocked addresses and follows redirects only within one host.
func NewHTTPClient() *http.Client {
	return &http.Client{
		Timeout:       requestTimeout,
		Transport:     &http.Transport{DialContext: safeDialContext, ResponseHeaderTimeout: requestTimeout},
		CheckRedirect: checkRedirect,
	}
}

// checkRedirect follows a redirect that stays on the same host name and does
// not drop from https to http, such as a reverse proxy sending http:// to
// https://. The API key header goes along with a followed redirect, so
// anything else is refused.
func checkRedirect(request *http.Request, via []*http.Request) error {
	if len(via) >= maxRedirects {
		return errors.Errorf("immich: stopped after %d redirects", maxRedirects)
	}
	first := via[0].URL
	if !strings.EqualFold(request.URL.Hostname(), first.Hostname()) || (first.Scheme == "https" && request.URL.Scheme != "https") {
		return &RedirectError{Target: request.URL.Scheme + "://" + request.URL.Host}
	}
	return nil
}

// NormalizeURL checks an Immich server address and returns it without a
// trailing slash or a trailing /api, which the client adds itself.
func NormalizeURL(rawURL string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Host == "" {
		return "", errors.New("immich: the server address must be a full URL, like http://immich.local:2283")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", errors.New("immich: the server address must start with http:// or https://")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("immich: the server address must not carry a user name, query or fragment")
	}
	path := strings.TrimRight(parsed.Path, "/")
	path = strings.TrimSuffix(path, "/api")
	parsed.Path = path
	parsed.RawPath = ""
	return parsed.String(), nil
}

// Client calls one Immich server with one API key.
type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

// NewClient returns a client for the server at rawURL. A nil httpClient uses
// NewHTTPClient.
func NewClient(rawURL, apiKey string, httpClient *http.Client) (*Client, error) {
	baseURL, err := NormalizeURL(rawURL)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(apiKey) == "" {
		return nil, errors.New("immich: an API key is required")
	}
	if httpClient == nil {
		httpClient = NewHTTPClient()
	}
	return &Client{baseURL: baseURL, apiKey: strings.TrimSpace(apiKey), http: httpClient}, nil
}

func (c *Client) newRequest(ctx context.Context, method, path string, body any) (*http.Request, error) {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, errors.Wrap(err, "immich: failed to encode request")
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, c.baseURL+"/api"+path, reader)
	if err != nil {
		return nil, errors.Wrap(err, "immich: failed to build request")
	}
	request.Header.Set("x-api-key", c.apiKey)
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	return request, nil
}

// do sends the request and returns the response when it succeeded; the
// caller closes its body.
func (c *Client) do(request *http.Request) (*http.Response, error) {
	response, err := c.http.Do(request)
	if err != nil {
		return nil, errors.Wrap(err, "immich: request failed")
	}
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		response.Body.Close()
		return nil, ErrUnauthorized
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		response.Body.Close()
		return nil, &StatusError{Code: response.StatusCode}
	}
	c.followMove(request.URL, response.Request.URL)
	return response, nil
}

// followMove keeps calling the server where a followed redirect led, such as
// https:// after http://, so later calls (POSTs included) skip the redirect.
func (c *Client) followMove(asked, answered *url.URL) {
	if answered == nil || (asked.Scheme == answered.Scheme && asked.Host == answered.Host) {
		return
	}
	base, err := url.Parse(c.baseURL)
	if err != nil {
		return
	}
	base.Scheme, base.Host = answered.Scheme, answered.Host
	c.baseURL = base.String()
}

// BaseURL is the server address the client calls: the one it was given, or
// where a followed redirect moved it.
func (c *Client) BaseURL() string {
	return c.baseURL
}

func (c *Client) getJSON(ctx context.Context, method, path string, body, out any) error {
	request, err := c.newRequest(ctx, method, path, body)
	if err != nil {
		return err
	}
	response, err := c.do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if err := json.NewDecoder(io.LimitReader(response.Body, maxJSONBytes)).Decode(out); err != nil {
		return errors.Wrap(ErrNotImmich, err.Error())
	}
	return nil
}

// User is the account an API key belongs to.
type User struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

// CurrentUser returns the account the API key belongs to, which proves the
// address and the key work.
func (c *Client) CurrentUser(ctx context.Context) (*User, error) {
	user := &User{}
	if err := c.getJSON(ctx, http.MethodGet, "/users/me", nil, user); err != nil {
		return nil, err
	}
	if user.ID == "" {
		return nil, errors.New("immich: the server's answer is not an Immich account")
	}
	return user, nil
}

// Album is one album of the key's account.
type Album struct {
	ID               string `json:"id"`
	Name             string `json:"albumName"`
	AssetCount       int    `json:"assetCount"`
	ThumbnailAssetID string `json:"albumThumbnailAssetId"`
}

// Albums lists the albums the key's account owns or shares.
func (c *Client) Albums(ctx context.Context) ([]Album, error) {
	albums := []Album{}
	if err := c.getJSON(ctx, http.MethodGet, "/albums", nil, &albums); err != nil {
		return nil, err
	}
	return albums, nil
}

// Photo is one image on the server.
type Photo struct {
	ID       string `json:"id"`
	FileName string `json:"originalFileName"`
	MimeType string `json:"originalMimeType"`
	TakenAt  string `json:"localDateTime"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
}

// PhotoPage is one page of photos, newest first. Next is empty on the last page.
type PhotoPage struct {
	Photos []Photo
	Next   string
}

type searchAnswer struct {
	Assets struct {
		Items      []Photo `json:"items"`
		NextCursor *string `json:"nextCursor"`
		NextPage   *string `json:"nextPage"`
	} `json:"assets"`
}

// SearchPhotos returns a page of the timeline's photos, newest first, or of
// one album's when albumID is set. next is the Next of the page before, or
// empty for the first page.
func (c *Client) SearchPhotos(ctx context.Context, albumID, next string) (*PhotoPage, error) {
	query := map[string]any{"size": PageSize, "order": "desc", "type": "IMAGE"}
	if albumID != "" {
		if !IsID(albumID) {
			return nil, errors.New("immich: invalid album ID")
		}
		query["albumIds"] = []string{albumID}
	} else {
		query["visibility"] = "timeline"
	}
	// Immich 3.2 and later page with a cursor; earlier versions with a page number.
	switch {
	case strings.HasPrefix(next, "c:"):
		query["cursor"] = strings.TrimPrefix(next, "c:")
	case strings.HasPrefix(next, "p:"):
		page, err := strconv.Atoi(strings.TrimPrefix(next, "p:"))
		if err != nil || page < 1 {
			return nil, errors.New("immich: invalid page")
		}
		query["page"] = page
	case next == "":
		query["page"] = 1
	default:
		return nil, errors.New("immich: invalid page")
	}

	answer := &searchAnswer{}
	if err := c.getJSON(ctx, http.MethodPost, "/search/metadata", query, answer); err != nil {
		return nil, err
	}
	page := &PhotoPage{Photos: answer.Assets.Items}
	if page.Photos == nil {
		page.Photos = []Photo{}
	}
	switch {
	case answer.Assets.NextCursor != nil && *answer.Assets.NextCursor != "":
		page.Next = "c:" + *answer.Assets.NextCursor
	case answer.Assets.NextPage != nil && *answer.Assets.NextPage != "":
		page.Next = "p:" + *answer.Assets.NextPage
	default:
	}
	return page, nil
}

// Thumbnail opens a small preview image of the asset. The caller closes the
// response body.
func (c *Client) Thumbnail(ctx context.Context, assetID string) (*http.Response, error) {
	return c.openAsset(ctx, assetID, "/thumbnail?size=thumbnail")
}

// Original opens the asset's original file. The caller closes the response
// body.
func (c *Client) Original(ctx context.Context, assetID string) (*http.Response, error) {
	return c.openAsset(ctx, assetID, "/original")
}

func (c *Client) openAsset(ctx context.Context, assetID, suffix string) (*http.Response, error) {
	if !IsID(assetID) {
		return nil, errors.New("immich: invalid asset ID")
	}
	request, err := c.newRequest(ctx, http.MethodGet, "/assets/"+assetID+suffix, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "*/*")
	return c.do(request)
}
