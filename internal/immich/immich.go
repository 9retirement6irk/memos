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
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/safehttp"
)

// PageSize is how many photos one page of SearchPhotos returns.
const PageSize = 60

const (
	requestTimeout = 30 * time.Second
	// maxJSONBytes bounds a JSON answer; a page of 60 assets is far smaller.
	maxJSONBytes = 8 << 20
)

// ErrUnauthorized means the server refused the API key.
var ErrUnauthorized = safehttp.ErrUnauthorized

// ErrBlockedAddress means the server address resolves only to the calling
// machine itself or to link-local space, which the client never dials.
var ErrBlockedAddress = safehttp.ErrBlockedAddress

// ErrNotImmich means something answered, but not with an Immich API answer.
var ErrNotImmich = safehttp.ErrUnexpectedAnswer

type (
	// BlockedAddressError names the host and the blocked address it resolved to.
	BlockedAddressError = safehttp.BlockedAddressError
	// StatusError is an answer outside 2xx (other than a refused key).
	StatusError = safehttp.StatusError
	// RedirectError is a redirect the client won't follow.
	RedirectError = safehttp.RedirectError
)

var assetIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// IsID reports whether value is an Immich asset or album ID.
func IsID(value string) bool {
	return assetIDPattern.MatchString(value)
}

// NewHTTPClient returns the HTTP client the package uses by default: it
// refuses blocked addresses and follows redirects only within one host.
func NewHTTPClient() *http.Client {
	return safehttp.NewClient(requestTimeout)
}

// NormalizeURL checks an Immich server address and returns it without a
// trailing slash or a trailing /api, which the client adds itself.
func NormalizeURL(rawURL string) (string, error) {
	normalized, err := safehttp.NormalizeBaseURL(rawURL, "immich.local:2283", "/api")
	if err != nil {
		return "", errors.Wrap(err, "immich")
	}
	return normalized, nil
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
	c.baseURL = safehttp.MovedBase(c.baseURL, request.URL, response.Request.URL)
	return response, nil
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
	// Exif is set only by PhotosTaken, which asks for it.
	Exif *Exif `json:"exifInfo,omitempty"`
}

// Exif is the part of a photo's EXIF the journal uses: when and where.
type Exif struct {
	Latitude  *float64 `json:"latitude"`
	Longitude *float64 `json:"longitude"`
	City      *string  `json:"city"`
	// TakenAt is the moment with its offset, unlike Photo.TakenAt, which is
	// local time written as if it were UTC.
	TakenAt *string `json:"dateTimeOriginal"`
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
	return c.search(ctx, query, next)
}

// PhotosTaken returns a page of the timeline's photos taken between after and
// before, oldest first, with their EXIF time and place. next is the Next of
// the page before, or empty for the first page.
func (c *Client) PhotosTaken(ctx context.Context, after, before time.Time, next string) (*PhotoPage, error) {
	if !before.After(after) {
		return nil, errors.New("immich: the time range is empty")
	}
	query := map[string]any{
		"size":        PageSize,
		"order":       "asc",
		"type":        "IMAGE",
		"visibility":  "timeline",
		"withExif":    true,
		"takenAfter":  after.UTC().Format(time.RFC3339),
		"takenBefore": before.UTC().Format(time.RFC3339),
	}
	return c.search(ctx, query, next)
}

func (c *Client) search(ctx context.Context, query map[string]any, next string) (*PhotoPage, error) {
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

// Preview opens the asset's preview: a JPEG at most 1440 px a side by
// default, which any browser can decode whatever the original's format. The
// caller closes the response body.
func (c *Client) Preview(ctx context.Context, assetID string) (*http.Response, error) {
	return c.openAsset(ctx, assetID, "/thumbnail?size=preview")
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
