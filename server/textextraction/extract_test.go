package textextraction

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/ratelimit"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

const geminiKey = "test-gemini-key-0003"

// fakeAI is a Claude and Gemini in one server. It answers the Claude model
// list for goodKey, and both APIs' text requests with "Text from <api>",
// recording what each request asked.
type fakeAI struct {
	server *httptest.Server

	mu       sync.Mutex
	requests []fakeRequest
	// fail makes the next text request fail with this status.
	fail int
}

type fakeRequest struct {
	api        string
	path       string
	model      string
	mediaTypes []string
	prompt     string
}

func newFakeAI(t *testing.T) *fakeAI {
	t.Helper()
	fake := &fakeAI{}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/models", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != goodKey {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = io.WriteString(w, `{"data":[{"id":"claude-haiku-5-5","type":"model"}]}`)
	})
	mux.HandleFunc("POST /v1/messages", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != goodKey {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var body struct {
			Model    string `json:"model"`
			Messages []struct {
				Content []struct {
					Type   string `json:"type"`
					Text   string `json:"text"`
					Source struct {
						MediaType string `json:"media_type"`
					} `json:"source"`
				} `json:"content"`
			} `json:"messages"`
		}
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		request := fakeRequest{api: "claude", path: r.URL.Path, model: body.Model}
		for _, block := range body.Messages[0].Content {
			if block.Type == "image" {
				request.mediaTypes = append(request.mediaTypes, block.Source.MediaType)
			} else {
				request.prompt = block.Text
			}
		}
		if fake.record(request, w) {
			_, _ = io.WriteString(w, `{"content":[{"type":"text","text":"Text from Claude"}],"stop_reason":"end_turn"}`)
		}
	})
	mux.HandleFunc("POST /v1beta/models/{model}", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-goog-api-key") != geminiKey {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		var body struct {
			Contents []struct {
				Parts []struct {
					Text       string `json:"text"`
					InlineData *struct {
						MimeType string `json:"mime_type"`
					} `json:"inline_data"`
				} `json:"parts"`
			} `json:"contents"`
		}
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		request := fakeRequest{api: "gemini", path: r.URL.Path, model: r.PathValue("model")}
		for _, part := range body.Contents[0].Parts {
			if part.InlineData != nil {
				request.mediaTypes = append(request.mediaTypes, part.InlineData.MimeType)
			} else {
				request.prompt = part.Text
			}
		}
		if fake.record(request, w) {
			_, _ = io.WriteString(w, `{"candidates":[{"content":{"parts":[{"text":"Text from Gemini"}]},"finishReason":"STOP"}]}`)
		}
	})
	fake.server = httptest.NewServer(mux)
	t.Cleanup(fake.server.Close)
	return fake
}

// record keeps the request and reports whether to answer it normally.
func (f *fakeAI) record(request fakeRequest, w http.ResponseWriter) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.requests = append(f.requests, request)
	if f.fail != 0 {
		w.WriteHeader(f.fail)
		f.fail = 0
		return false
	}
	return true
}

// failNext makes the next text request fail with status.
func (f *fakeAI) failNext(status int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.fail = status
}

func (f *fakeAI) last(t *testing.T) fakeRequest {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	require.NotEmpty(t, f.requests)
	return f.requests[len(f.requests)-1]
}

func (f *fakeAI) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.requests)
}

// pngPicture is a real PNG, so its type can be detected from its bytes.
func pngPicture(t *testing.T) string {
	t.Helper()
	var buffer bytes.Buffer
	require.NoError(t, png.Encode(&buffer, image.NewRGBA(image.Rect(0, 0, 4, 4))))
	return base64.StdEncoding.EncodeToString(buffer.Bytes())
}

// newAttachment adds a memo with one attachment, and returns the attachment's name.
func newAttachment(ctx context.Context, t *testing.T, env *testEnv, creatorID int32, uid, mediaType string, visibility store.Visibility) string {
	t.Helper()
	memo, err := env.store.CreateMemo(ctx, &store.Memo{UID: uid + "-memo", CreatorID: creatorID, Content: "A memo", Visibility: visibility})
	require.NoError(t, err)
	_, err = env.store.CreateAttachment(ctx, &store.Attachment{
		UID: uid, CreatorID: creatorID, Filename: uid + ".file", Type: mediaType, MemoID: &memo.ID,
		Blob: []byte("bytes"), Payload: &storepb.AttachmentPayload{},
	})
	require.NoError(t, err)
	return "attachments/" + uid
}

func extractBody(attachment string, images ...string) string {
	parts := make([]string, len(images))
	for i, data := range images {
		parts[i] = `{"mediaType":"image/png","data":"` + data + `"}`
	}
	return `{"attachment":"` + attachment + `","images":[` + strings.Join(parts, ",") + `]}`
}

func useClaude(t *testing.T, env *testEnv, fake *fakeAI) {
	t.Helper()
	decode(t, env.do(http.MethodPut, "/api/text-extraction/claude", `{"endpoint":"`+fake.server.URL+`","apiKey":"`+goodKey+`"}`, env.admin))
	decode(t, env.do(http.MethodPut, "/api/text-extraction/settings", `{"providerId":"claude"}`, env.admin))
}

func status(t *testing.T, env *testEnv, token string) bool {
	t.Helper()
	recorder := env.do(http.MethodGet, "/api/text-extraction/status", "", token)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	response := StatusResponse{}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &response))
	return response.Enabled
}

func TestStatus(t *testing.T) {
	ctx := context.Background()
	fake := newFakeAI(t)
	env := newTestEnv(ctx, t, fake.server)
	require.Equal(t, http.StatusUnauthorized, env.do(http.MethodGet, "/api/text-extraction/status", "", "").Code)
	require.False(t, status(t, env, env.user))
	useClaude(t, env, fake)
	// Every signed-in user learns that it's on, and nothing about the connection.
	recorder := env.do(http.MethodGet, "/api/text-extraction/status", "", env.user)
	require.NotContains(t, recorder.Body.String(), goodKey)
	require.NotContains(t, recorder.Body.String(), fake.server.URL)
	require.True(t, status(t, env, env.user))
	require.Zero(t, fake.count(), "the status makes no request")
}

func TestExtractWithClaude(t *testing.T) {
	ctx := context.Background()
	fake := newFakeAI(t)
	env := newTestEnv(ctx, t, fake.server)
	picture := pngPicture(t)
	scan := newAttachment(ctx, t, env, env.userID, "scan", "image/png", store.Private)

	// Off until an admin chooses a provider.
	require.Equal(t, http.StatusConflict, env.do(http.MethodPost, "/api/text-extraction/extract", extractBody(scan, picture), env.user).Code)
	useClaude(t, env, fake)

	recorder := env.do(http.MethodPost, "/api/text-extraction/extract", extractBody(scan, picture, picture), env.user)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	response := ExtractResponse{}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &response))
	require.Equal(t, ExtractResponse{Text: "Text from Claude", Pages: []string{}}, response)
	request := fake.last(t)
	require.Equal(t, "claude", request.api)
	require.Equal(t, "claude-haiku-5-5", request.model)
	require.Equal(t, []string{"image/png", "image/png"}, request.mediaTypes)
	require.Equal(t, Instructions, request.prompt)
}

func TestExtractChecksTheAttachment(t *testing.T) {
	ctx := context.Background()
	fake := newFakeAI(t)
	env := newTestEnv(ctx, t, fake.server)
	useClaude(t, env, fake)
	picture := pngPicture(t)
	private := newAttachment(ctx, t, env, env.adminID, "admins-scan", "image/png", store.Private)
	public := newAttachment(ctx, t, env, env.adminID, "public-scan", "image/png", store.Public)
	text := newAttachment(ctx, t, env, env.userID, "notes", "text/plain", store.Private)
	extract := func(body, token string) int {
		return env.do(http.MethodPost, "/api/text-extraction/extract", body, token).Code
	}

	// Another user's private file is "not found"; a public one can be read.
	require.Equal(t, http.StatusNotFound, extract(extractBody(private, picture), env.user))
	require.Equal(t, http.StatusNotFound, extract(extractBody("attachments/missing", picture), env.user))
	require.Equal(t, http.StatusNotFound, extract(extractBody("memos/1", picture), env.user))
	require.Equal(t, http.StatusOK, extract(extractBody(public, picture), env.user))
	require.Equal(t, http.StatusBadRequest, extract(extractBody(text, picture), env.user))

	// The pictures themselves.
	require.Equal(t, http.StatusBadRequest, extract(extractBody(public), env.user))
	many := make([]string, MaxImages+1)
	for i := range many {
		many[i] = picture
	}
	require.Equal(t, http.StatusBadRequest, extract(extractBody(public, many...), env.user))
	require.Equal(t, http.StatusBadRequest, extract(`{"attachment":"`+public+`","images":[{"mediaType":"image/svg+xml","data":"`+picture+`"}]}`, env.user))
	require.Equal(t, http.StatusBadRequest, extract(extractBody(public, "not base64!"), env.user))
	tooLarge := base64.StdEncoding.EncodeToString(make([]byte, MaxImageBytes+1))
	require.Equal(t, http.StatusRequestEntityTooLarge, extract(extractBody(public, tooLarge), env.user))

	// An extraction is paid for, so a session cookie alone can't start one.
	request := httptest.NewRequest(http.MethodPost, "/api/text-extraction/extract", strings.NewReader(extractBody(public, picture)))
	request.Header.Set("Cookie", "memos.access-token="+env.user)
	recorder := httptest.NewRecorder()
	env.mux.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusUnauthorized, recorder.Code)
	require.Equal(t, http.StatusUnauthorized, extract(extractBody(public, picture), ""))
}

func TestExtractWithGemini(t *testing.T) {
	ctx := context.Background()
	fake := newFakeAI(t)
	env := newTestEnv(ctx, t, fake.server)
	_, err := env.store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_AI,
		Value: &storepb.InstanceSetting_AiSetting{AiSetting: &storepb.InstanceAISetting{Providers: []*storepb.AIProviderConfig{
			{Id: "gemini-1", Title: "Gemini", Type: storepb.AIProviderType_GEMINI, Endpoint: fake.server.URL + "/v1beta", ApiKey: geminiKey},
		}}},
	})
	require.NoError(t, err)
	decode(t, env.do(http.MethodPut, "/api/text-extraction/settings", `{"providerId":"gemini-1","model":"gemini-test"}`, env.admin))
	require.True(t, status(t, env, env.user))
	scan := newAttachment(ctx, t, env, env.userID, "drawing", "image/png", store.Private)

	recorder := env.do(http.MethodPost, "/api/text-extraction/extract", extractBody(scan, pngPicture(t)), env.user)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	require.Contains(t, recorder.Body.String(), "Text from Gemini")
	request := fake.last(t)
	require.Equal(t, "gemini", request.api)
	require.Equal(t, "/v1beta/models/gemini-test:generateContent", request.path)
	require.Equal(t, []string{"image/png"}, request.mediaTypes)
	require.Equal(t, Instructions, request.prompt)

	// A refused request says why, without the key.
	fake.failNext(http.StatusTooManyRequests)
	refused := env.do(http.MethodPost, "/api/text-extraction/extract", extractBody(scan, pngPicture(t)), env.user)
	require.Equal(t, http.StatusBadGateway, refused.Code)
	require.Contains(t, refused.Body.String(), "rate limited")
	require.NotContains(t, refused.Body.String(), geminiKey)
}

func TestExtractRateLimit(t *testing.T) {
	ctx := context.Background()
	fake := newFakeAI(t)
	env := newTestEnv(ctx, t, fake.server)
	env.service.Limiter = ratelimit.NewMemoryLimiter(ratelimit.Policy{rateLimitScope: {Limit: 1, Window: time.Hour}})
	useClaude(t, env, fake)
	scan := newAttachment(ctx, t, env, env.userID, "limited", "image/png", store.Private)
	body := extractBody(scan, pngPicture(t))

	// A failed call doesn't count.
	fake.failNext(529)
	require.Equal(t, http.StatusBadGateway, env.do(http.MethodPost, "/api/text-extraction/extract", body, env.user).Code)
	require.Equal(t, http.StatusOK, env.do(http.MethodPost, "/api/text-extraction/extract", body, env.user).Code)

	limited := env.do(http.MethodPost, "/api/text-extraction/extract", body, env.user)
	require.Equal(t, http.StatusTooManyRequests, limited.Code)
	require.NotEmpty(t, limited.Header().Get("Retry-After"))

	// Each user has their own allowance.
	own := newAttachment(ctx, t, env, env.adminID, "admins-own", "image/png", store.Private)
	require.Equal(t, http.StatusOK, env.do(http.MethodPost, "/api/text-extraction/extract", extractBody(own, pngPicture(t)), env.admin).Code)
}

func TestAnswerSplitsPages(t *testing.T) {
	require.Equal(t, &ExtractResponse{Text: "One", Pages: []string{"One"}}, answer("One", false, 1))
	require.Equal(t, &ExtractResponse{Text: "One\nline\n\nTwo", Pages: []string{"One\nline", "Two"}}, answer("One\nline\n<<<PAGE>>>\nTwo\n", false, 2))
	// A page without text keeps its place.
	require.Equal(t, &ExtractResponse{Text: "One\n\nThree", Pages: []string{"One", "", "Three"}}, answer("One\n<<<PAGE>>>\n<<<PAGE>>>\nThree", false, 3))
	// Stray breaks at the ends are dropped.
	require.Equal(t, []string{"One", "Two"}, answer("<<<PAGE>>>\nOne\n <<<PAGE>>> \nTwo\n<<<PAGE>>>", false, 2).Pages)
	// When the parts don't match the pictures, only the whole text is given.
	mismatched := answer("One\n<<<PAGE>>>\nTwo", true, 3)
	require.Empty(t, mismatched.Pages)
	require.Equal(t, "One\n\nTwo", mismatched.Text)
	require.True(t, mismatched.Truncated)
	require.Equal(t, &ExtractResponse{Pages: []string{""}}, answer("", false, 1))
}
