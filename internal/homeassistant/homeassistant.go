// Package homeassistant is a small client for a user's own Home Assistant: it
// checks a long-lived access token, lists the notify services and sends a
// notification that opens a link when tapped.
package homeassistant

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/safehttp"
)

const (
	requestTimeout = 20 * time.Second
	maxBodyBytes   = 4 << 20
)

// Service describes Home Assistant for failure messages.
var Service = safehttp.Service{
	Name:        "Home Assistant",
	ExampleURL:  "http://192.168.1.20:8123",
	DefaultPort: "8123",
	KeyName:     "access token",
	KeyHelp:     "Create a long-lived access token on your Home Assistant profile page and paste it whole.",
}

// Explain says why a call to Home Assistant failed and what to change.
func Explain(err error) string {
	return safehttp.Explain(err, Service)
}

// notifierPattern is a notify service as Home Assistant names it.
var notifierPattern = regexp.MustCompile(`^notify\.[a-z0-9_]+$`)

// IsNotifier reports whether name is a notify service name, like
// "notify.mobile_app_phone".
func IsNotifier(name string) bool {
	return notifierPattern.MatchString(name)
}

// NormalizeURL checks a Home Assistant address a person typed and returns its base.
func NormalizeURL(rawURL string) (string, error) {
	normalized, err := safehttp.NormalizeBaseURL(rawURL, Service.ExampleURL, "/api")
	if err != nil {
		return "", errors.Wrap(err, "home assistant")
	}
	return normalized, nil
}

// Client calls one Home Assistant with one long-lived access token.
type Client struct {
	baseURL string
	token   string
	http    *http.Client
}

// NewClient returns a client for the Home Assistant at rawURL. A nil
// httpClient uses a client that refuses the Memos server's own addresses.
func NewClient(rawURL, token string, httpClient *http.Client) (*Client, error) {
	baseURL, err := NormalizeURL(rawURL)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(token) == "" {
		return nil, errors.New("home assistant: the access token is empty")
	}
	if httpClient == nil {
		httpClient = safehttp.NewClient(requestTimeout)
	}
	return &Client{baseURL: baseURL, token: strings.TrimSpace(token), http: httpClient}, nil
}

// BaseURL is the address the client calls, after any followed redirect.
func (c *Client) BaseURL() string {
	return c.baseURL
}

func (c *Client) do(ctx context.Context, method, path string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return errors.Wrap(err, "home assistant: failed to encode request")
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, c.baseURL+"/api"+path, reader)
	if err != nil {
		return errors.Wrap(err, "home assistant: failed to build request")
	}
	request.Header.Set("Authorization", "Bearer "+c.token)
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := c.http.Do(request)
	if err != nil {
		return errors.Wrap(err, "home assistant: request failed")
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		return safehttp.ErrUnauthorized
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return &safehttp.StatusError{Code: response.StatusCode}
	}
	c.baseURL = safehttp.MovedBase(c.baseURL, request.URL, response.Request.URL)
	if out == nil {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, maxBodyBytes))
		return nil
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, maxBodyBytes)).Decode(out); err != nil {
		return errors.Wrap(safehttp.ErrUnexpectedAnswer, err.Error())
	}
	return nil
}

// Check confirms the address and token work.
func (c *Client) Check(ctx context.Context) error {
	answer := struct {
		Message string `json:"message"`
	}{}
	if err := c.do(ctx, http.MethodGet, "/", nil, &answer); err != nil {
		return err
	}
	if answer.Message == "" {
		return safehttp.ErrUnexpectedAnswer
	}
	return nil
}

// Notifiers lists the notify services, like "notify.mobile_app_phone", sorted.
func (c *Client) Notifiers(ctx context.Context) ([]string, error) {
	domains := []struct {
		Domain   string                     `json:"domain"`
		Services map[string]json.RawMessage `json:"services"`
	}{}
	if err := c.do(ctx, http.MethodGet, "/services", nil, &domains); err != nil {
		return nil, err
	}
	notifiers := []string{}
	for _, domain := range domains {
		if domain.Domain != "notify" {
			continue
		}
		for name := range domain.Services {
			if IsNotifier("notify." + name) {
				notifiers = append(notifiers, "notify."+name)
			}
		}
	}
	sort.Strings(notifiers)
	return notifiers, nil
}

// Notification is one message to send.
type Notification struct {
	Title   string
	Message string
	// URL opens when the notification is tapped; empty opens nothing.
	URL string
	// ActionTitle labels a button that opens URL, like "Write now"; empty adds none.
	ActionTitle string
}

// Notify sends the notification through the notify service named, like
// "notify.mobile_app_phone".
func (c *Client) Notify(ctx context.Context, notifier string, notification Notification) error {
	if !IsNotifier(notifier) {
		return errors.Errorf("home assistant: %q is not a notify service", notifier)
	}
	body := map[string]any{"title": notification.Title, "message": notification.Message}
	if notification.URL != "" {
		// The companion apps read the tap target from different keys: url on
		// iOS, clickAction on Android.
		data := map[string]any{"url": notification.URL, "clickAction": notification.URL}
		if notification.ActionTitle != "" {
			data["actions"] = []map[string]string{{"action": "URI", "title": notification.ActionTitle, "uri": notification.URL}}
		}
		body["data"] = data
	}
	return c.do(ctx, http.MethodPost, "/services/notify/"+strings.TrimPrefix(notifier, "notify."), body, nil)
}
