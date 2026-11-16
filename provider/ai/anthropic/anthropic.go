// Package anthropic calls Anthropic's Messages API, for Claude. The fork uses
// it to read the text out of images, drawings and PDFs. It speaks the HTTP API
// directly rather than through Anthropic's SDK, which would be a large
// dependency for two requests.
//
// The API key is sent only in the x-api-key header and never appears in an
// error this package returns.
package anthropic

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/pkg/errors"
)

const (
	// DefaultEndpoint is Anthropic's API, used when no endpoint is set.
	DefaultEndpoint = "https://api.anthropic.com"
	// DefaultModel reads text well and is the cheapest and fastest Claude model.
	DefaultModel = "claude-haiku-5-5"
	// apiVersion is the Messages API version every request names.
	apiVersion = "2023-06-01"
	// maxErrorBody bounds how much of an error response is read.
	maxErrorBody = 8 << 10
)

var (
	// ErrUnauthorized means Anthropic rejected the API key.
	ErrUnauthorized = errors.New("the API key was rejected by Anthropic")
	// ErrForbidden means the key may not use what was asked for.
	ErrForbidden = errors.New("this API key is not allowed to use the Claude API")
	// ErrNotFound means the endpoint has no Claude API, or the model does not exist.
	ErrNotFound = errors.New("no Claude API at this address")
	// ErrRateLimited means Anthropic asked to slow down.
	ErrRateLimited = errors.New("the API key is being rate limited by Anthropic; try again shortly")
	// ErrOverloaded means Anthropic is busy.
	ErrOverloaded = errors.New("the Claude API is overloaded; try again shortly")
)

// Client calls one Anthropic endpoint with one API key.
type Client struct {
	endpoint string
	apiKey   string
	http     *http.Client
}

// NormalizeEndpoint checks an endpoint someone typed, defaulting to Anthropic's
// API. It keeps the scheme, host and any path prefix (for a proxy), without a
// trailing slash or a trailing /v1.
func NormalizeEndpoint(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return DefaultEndpoint, nil
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
		return "", errors.New("enter the endpoint as a full address, like https://api.anthropic.com")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("the endpoint can't include a user name, a query or a fragment")
	}
	path := strings.TrimRight(parsed.Path, "/")
	path = strings.TrimSuffix(path, "/v1")
	return parsed.Scheme + "://" + parsed.Host + path, nil
}

// New returns a client. httpClient may be nil for a plain client with a
// two-minute timeout; servers pass one that refuses private addresses.
func New(endpoint, apiKey string, httpClient *http.Client) (*Client, error) {
	normalized, err := NormalizeEndpoint(endpoint)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(apiKey) == "" {
		return nil, errors.New("an Anthropic API key is required")
	}
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 2 * time.Minute}
	}
	return &Client{endpoint: normalized, apiKey: strings.TrimSpace(apiKey), http: httpClient}, nil
}

// Endpoint is the normalized endpoint the client calls.
func (c *Client) Endpoint() string { return c.endpoint }

// Check makes sure the key works, by listing one model. Listing models is
// free: it reads nothing and generates nothing.
func (c *Client) Check(ctx context.Context) error {
	request, err := c.newRequest(ctx, http.MethodGet, "/v1/models?limit=1", nil)
	if err != nil {
		return err
	}
	response, err := c.http.Do(request)
	if err != nil {
		return errors.Wrap(err, "failed to reach the Claude API")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return statusError(response)
	}
	var listing struct {
		Data []json.RawMessage `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&listing); err != nil {
		return errors.Wrap(ErrNotFound, "the answer was not a Claude model list")
	}
	return nil
}

func (c *Client) newRequest(ctx context.Context, method, path string, body io.Reader) (*http.Request, error) {
	request, err := http.NewRequestWithContext(ctx, method, c.endpoint+path, body)
	if err != nil {
		return nil, errors.Wrap(err, "failed to build the request")
	}
	request.Header.Set("x-api-key", c.apiKey)
	request.Header.Set("anthropic-version", apiVersion)
	if body != nil {
		request.Header.Set("content-type", "application/json")
	}
	return request, nil
}

// statusError turns an error response into one of the package's errors,
// adding Anthropic's own message (which never contains the key).
func statusError(response *http.Response) error {
	var payload struct {
		Error struct {
			Type    string `json:"type"`
			Message string `json:"message"`
		} `json:"error"`
	}
	raw, _ := io.ReadAll(io.LimitReader(response.Body, maxErrorBody))
	_ = json.Unmarshal(raw, &payload)
	message := strings.TrimSpace(payload.Error.Message)
	var base error
	switch response.StatusCode {
	case http.StatusUnauthorized:
		base = ErrUnauthorized
	case http.StatusForbidden:
		base = ErrForbidden
	case http.StatusNotFound:
		base = ErrNotFound
	case http.StatusTooManyRequests:
		base = ErrRateLimited
	case 529:
		base = ErrOverloaded
	default:
		base = errors.Errorf("the Claude API answered %d", response.StatusCode)
	}
	if message != "" {
		return errors.Wrap(base, message)
	}
	return base
}
