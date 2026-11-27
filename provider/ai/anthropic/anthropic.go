// Package anthropic calls Anthropic's Messages API, for Claude. The fork uses
// it to read the text out of images, drawings and PDFs, and to suggest tags.
// It speaks the HTTP API directly rather than through Anthropic's SDK, which
// would be a large dependency for three requests.
//
// The API key is sent only in the x-api-key header and never appears in an
// error this package returns.
package anthropic

import (
	"bytes"
	"context"
	"encoding/base64"
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
	// ErrBadRequest means Anthropic refused the request itself, for example an
	// image it can't read or a model name it doesn't know. Its own message,
	// wrapped around this error, says which.
	ErrBadRequest = errors.New("the Claude API refused the request")
	// ErrRefused means Claude declined to answer.
	ErrRefused = errors.New("the model declined to read this file")
	// ErrIncomplete means an answer that had to be whole stopped before its end.
	ErrIncomplete = errors.New("the model's answer was cut short")
)

// Image is one picture to send: PNG, JPEG, GIF or WebP bytes.
type Image struct {
	MediaType string
	Data      []byte
}

// TextRequest asks Claude to read the text in some images.
type TextRequest struct {
	Model        string
	Instructions string
	Images       []Image
	// MaxTokens bounds the answer; zero means 8192.
	MaxTokens int
}

// TextResult is Claude's answer.
type TextResult struct {
	Text string
	// Truncated means the answer reached MaxTokens before it ended.
	Truncated bool
}

// GenerateRequest asks Claude to answer some text.
type GenerateRequest struct {
	Model string
	// System is the instruction the answer follows.
	System string
	// Input is the user's message.
	Input string
	// MaxTokens bounds the answer; zero means 1024.
	MaxTokens int
}

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

// ReadText sends the images, then the instructions, in one user message and
// returns the text of Claude's answer.
func (c *Client) ReadText(ctx context.Context, request TextRequest) (*TextResult, error) {
	if strings.TrimSpace(request.Model) == "" {
		return nil, errors.New("a model is required")
	}
	if len(request.Images) == 0 {
		return nil, errors.New("at least one image is required")
	}
	maxTokens := request.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 8192
	}
	content := make([]map[string]any, 0, len(request.Images)+1)
	for _, image := range request.Images {
		content = append(content, map[string]any{
			"type": "image",
			"source": map[string]string{
				"type":       "base64",
				"media_type": image.MediaType,
				"data":       base64.StdEncoding.EncodeToString(image.Data),
			},
		})
	}
	content = append(content, map[string]any{"type": "text", "text": request.Instructions})
	body, err := json.Marshal(map[string]any{
		"model":      strings.TrimSpace(request.Model),
		"max_tokens": maxTokens,
		"messages":   []map[string]any{{"role": "user", "content": content}},
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to encode the request")
	}
	text, stopReason, err := c.send(ctx, body)
	if err != nil {
		return nil, err
	}
	return &TextResult{Text: text, Truncated: stopReason == "max_tokens"}, nil
}

// Generate sends the input under the system instruction and returns the text
// of Claude's answer. An answer that did not end by itself is ErrIncomplete.
func (c *Client) Generate(ctx context.Context, request GenerateRequest) (string, error) {
	if strings.TrimSpace(request.Model) == "" {
		return "", errors.New("a model is required")
	}
	maxTokens := request.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 1024
	}
	payload := map[string]any{
		"model":      strings.TrimSpace(request.Model),
		"max_tokens": maxTokens,
		"messages":   []map[string]any{{"role": "user", "content": request.Input}},
	}
	if request.System != "" {
		payload["system"] = request.System
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", errors.Wrap(err, "failed to encode the request")
	}
	text, stopReason, err := c.send(ctx, body)
	if err != nil {
		return "", err
	}
	if stopReason != "end_turn" && stopReason != "stop_sequence" {
		return "", ErrIncomplete
	}
	return text, nil
}

// send posts one Messages request and returns the text of the answer, trimmed,
// and why it stopped. A refusal is ErrRefused.
func (c *Client) send(ctx context.Context, body []byte) (string, string, error) {
	httpRequest, err := c.newRequest(ctx, http.MethodPost, "/v1/messages", bytes.NewReader(body))
	if err != nil {
		return "", "", err
	}
	response, err := c.http.Do(httpRequest)
	if err != nil {
		return "", "", errors.Wrap(err, "failed to reach the Claude API")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", "", statusError(response)
	}
	var message struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		StopReason string `json:"stop_reason"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 8<<20)).Decode(&message); err != nil {
		return "", "", errors.Wrap(ErrNotFound, "the answer was not a Claude message")
	}
	if message.StopReason == "refusal" {
		return "", "", ErrRefused
	}
	var text strings.Builder
	for _, block := range message.Content {
		if block.Type == "text" {
			text.WriteString(block.Text)
		}
	}
	return strings.TrimSpace(text.String()), message.StopReason, nil
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
	case http.StatusBadRequest, http.StatusRequestEntityTooLarge:
		base = ErrBadRequest
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
