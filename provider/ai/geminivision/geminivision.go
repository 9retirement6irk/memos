// Package geminivision asks Gemini to read the text in images, for the fork's
// text extraction. Stock Memos' Gemini client (provider/ai/audiollm/gemini)
// sends audio only, so this package calls generateContent itself, over plain
// HTTP, with the same endpoint and key as the instance's Gemini provider.
//
// The API key is sent only in the x-goog-api-key header and never appears in
// an error this package returns.
package geminivision

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
	// DefaultEndpoint is Google's Gemini API, as stock Memos uses it.
	DefaultEndpoint = "https://generativelanguage.googleapis.com/v1beta"
	// DefaultModel reads text well and is quick and cheap.
	DefaultModel = "gemini-2.5-flash"
	// maxErrorBody bounds how much of an error response is read.
	maxErrorBody = 8 << 10
)

var (
	// ErrBadRequest means Gemini refused the request, for example a bad key,
	// an image it can't read or a model it doesn't know. Its own message,
	// wrapped around this error, says which.
	ErrBadRequest = errors.New("the Gemini API refused the request")
	// ErrUnauthorized means the key may not use the Gemini API.
	ErrUnauthorized = errors.New("this API key is not allowed to use the Gemini API")
	// ErrNotFound means there is no such model, or no Gemini API at the endpoint.
	ErrNotFound = errors.New("no such Gemini model at this address")
	// ErrRateLimited means Google asked to slow down.
	ErrRateLimited = errors.New("the API key is being rate limited by Google; try again shortly")
	// ErrOverloaded means Gemini is busy.
	ErrOverloaded = errors.New("the Gemini API is overloaded; try again shortly")
	// ErrBlocked means Gemini stopped without giving the text, for example for
	// safety or because the text matches published material.
	ErrBlocked = errors.New("the model stopped without giving the text")
)

// Image is one picture to send: PNG, JPEG, GIF or WebP bytes.
type Image struct {
	MediaType string
	Data      []byte
}

// TextRequest asks Gemini to read the text in some images.
type TextRequest struct {
	Model        string
	Instructions string
	Images       []Image
	// MaxTokens bounds the answer; zero leaves it to the model.
	MaxTokens int
}

// TextResult is Gemini's answer.
type TextResult struct {
	Text string
	// Truncated means the answer reached its token limit before it ended.
	Truncated bool
}

// Client calls one Gemini endpoint with one API key.
type Client struct {
	endpoint string
	apiKey   string
	http     *http.Client
}

// NormalizeEndpoint accepts the endpoints stock Memos accepts for Gemini: empty
// for Google's, or a base address with or without an API version at its end.
// Without one, v1beta is used, as stock Memos does.
func NormalizeEndpoint(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return DefaultEndpoint, nil
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
		return "", errors.New("the Gemini endpoint is not a full address")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("the Gemini endpoint can't include a user name, a query or a fragment")
	}
	path := strings.TrimRight(parsed.Path, "/")
	hasVersion := false
	for _, version := range []string{"v1alpha", "v1beta", "v1"} {
		if strings.HasSuffix(path, "/"+version) {
			hasVersion = true
			break
		}
	}
	if !hasVersion {
		path += "/v1beta"
	}
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
		return nil, errors.New("a Gemini API key is required")
	}
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 2 * time.Minute}
	}
	return &Client{endpoint: normalized, apiKey: strings.TrimSpace(apiKey), http: httpClient}, nil
}

type part struct {
	Text       string      `json:"text,omitempty"`
	InlineData *inlineData `json:"inline_data,omitempty"`
}

type inlineData struct {
	MimeType string `json:"mime_type"`
	Data     string `json:"data"`
}

// ReadText sends the images, then the instructions, in one user turn and
// returns the text of Gemini's answer.
func (c *Client) ReadText(ctx context.Context, request TextRequest) (*TextResult, error) {
	model := strings.TrimPrefix(strings.TrimSpace(request.Model), "models/")
	if model == "" {
		return nil, errors.New("a model is required")
	}
	if len(request.Images) == 0 {
		return nil, errors.New("at least one image is required")
	}
	parts := make([]part, 0, len(request.Images)+1)
	for _, image := range request.Images {
		parts = append(parts, part{InlineData: &inlineData{MimeType: image.MediaType, Data: base64.StdEncoding.EncodeToString(image.Data)}})
	}
	parts = append(parts, part{Text: request.Instructions})
	payload := map[string]any{"contents": []map[string]any{{"role": "user", "parts": parts}}}
	if request.MaxTokens > 0 {
		payload["generationConfig"] = map[string]any{"maxOutputTokens": request.MaxTokens}
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, errors.Wrap(err, "failed to encode the request")
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint+"/models/"+url.PathEscape(model)+":generateContent", bytes.NewReader(body))
	if err != nil {
		return nil, errors.Wrap(err, "failed to build the request")
	}
	httpRequest.Header.Set("x-goog-api-key", c.apiKey)
	httpRequest.Header.Set("content-type", "application/json")
	response, err := c.http.Do(httpRequest)
	if err != nil {
		return nil, errors.Wrap(err, "failed to reach the Gemini API")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, statusError(response)
	}
	var answer struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text    string `json:"text"`
					Thought bool   `json:"thought"`
				} `json:"parts"`
			} `json:"content"`
			FinishReason string `json:"finishReason"`
		} `json:"candidates"`
		PromptFeedback struct {
			BlockReason string `json:"blockReason"`
		} `json:"promptFeedback"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 8<<20)).Decode(&answer); err != nil {
		return nil, errors.Wrap(ErrNotFound, "the answer was not a Gemini response")
	}
	if answer.PromptFeedback.BlockReason != "" {
		return nil, errors.Wrap(ErrBlocked, strings.ToLower(answer.PromptFeedback.BlockReason))
	}
	if len(answer.Candidates) == 0 {
		return &TextResult{}, nil
	}
	candidate := answer.Candidates[0]
	var text strings.Builder
	for _, piece := range candidate.Content.Parts {
		if !piece.Thought {
			text.WriteString(piece.Text)
		}
	}
	switch candidate.FinishReason {
	case "", "STOP", "FINISH_REASON_UNSPECIFIED":
	case "MAX_TOKENS":
		return &TextResult{Text: strings.TrimSpace(text.String()), Truncated: true}, nil
	default:
		return nil, errors.Wrap(ErrBlocked, strings.ToLower(candidate.FinishReason))
	}
	return &TextResult{Text: strings.TrimSpace(text.String())}, nil
}

// statusError turns an error response into one of the package's errors,
// adding Google's own message (which never contains the key).
func statusError(response *http.Response) error {
	var payload struct {
		Error struct {
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
	case http.StatusUnauthorized, http.StatusForbidden:
		base = ErrUnauthorized
	case http.StatusNotFound:
		base = ErrNotFound
	case http.StatusTooManyRequests:
		base = ErrRateLimited
	case http.StatusServiceUnavailable:
		base = ErrOverloaded
	default:
		base = errors.Errorf("the Gemini API answered %d", response.StatusCode)
	}
	if message != "" {
		return errors.Wrap(base, message)
	}
	return base
}
