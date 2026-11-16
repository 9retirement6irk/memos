package textextraction

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/pkg/errors"

	"github.com/usememos/memos/core/access"
	"github.com/usememos/memos/internal/httphandler"
	"github.com/usememos/memos/internal/ratelimit"
	"github.com/usememos/memos/internal/safehttp"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/provider/ai/anthropic"
	"github.com/usememos/memos/provider/ai/geminivision"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
)

const (
	// MaxImages is how many pictures one request may carry: the pages of a
	// scanned PDF, or one image or drawing.
	MaxImages = 20
	// MaxImageBytes is the largest picture, after the browser has scaled it
	// down. Claude takes up to 5 MB of base64, which is this many bytes.
	MaxImageBytes = 3_750_000
	// maxImagesBytes bounds all the pictures of one request together, well
	// under the 32 MB a Claude request may be.
	maxImagesBytes = 20 << 20
	// maxExtractBody bounds the request body: the pictures in base64 and a
	// little JSON.
	maxExtractBody = maxImagesBytes/3*4 + 64<<10
	// extractTimeout bounds one call to the AI. Twenty pages of dense
	// handwriting take a while.
	extractTimeout = 3 * time.Minute
	// maxAnswerTokens bounds the answer.
	maxAnswerTokens = 16384
	// rateLimitScope is the fork's own limiter scope, beside stock's.
	rateLimitScope ratelimit.Scope = "text_extraction_user"
)

// rateLimitRule is how many extractions one user may ask for: each one is a
// paid call on the instance's key.
var rateLimitRule = ratelimit.Rule{Limit: 30, Window: time.Hour}

// Instructions is what the AI is asked to do with the pictures.
const Instructions = `Transcribe all of the text in these images exactly as it is written, including handwriting.
The images are the pages of one file, in order. Between the text of one page and the next, put a line containing only ` + PageBreak + `.
Keep the original line breaks, spelling and punctuation. Don't correct, translate, summarize or describe anything.
Answer with the text alone: no introduction, no commentary and no Markdown formatting.
If there is no text at all, answer with nothing.`

// PageBreak is the line the AI puts between pages, so the browser can put each
// page's text back in its place among the pages it read itself.
const PageBreak = "<<<PAGE>>>"

// mediaTypes are the picture types both Claude and Gemini read.
var mediaTypes = map[string]bool{"image/png": true, "image/jpeg": true, "image/webp": true, "image/gif": true}

// ExtractImage is one picture, base64-encoded.
type ExtractImage struct {
	MediaType string `json:"mediaType"`
	Data      string `json:"data"`
}

// ExtractRequest asks for the text in an attachment. The browser prepares the
// pictures (it scales images down and renders the scanned pages of a PDF);
// the attachment names the file they come from, which the user must be able
// to read.
type ExtractRequest struct {
	Attachment string         `json:"attachment"`
	Images     []ExtractImage `json:"images"`
}

// ExtractResponse is the text the AI read.
type ExtractResponse struct {
	// Text is all of it, with a blank line between pages.
	Text string `json:"text"`
	// Pages is the text of each picture, in order, when the answer could be
	// split into exactly one part per picture; otherwise it is empty.
	Pages []string `json:"pages"`
	// Truncated means the answer hit its length limit: the text is incomplete.
	Truncated bool `json:"truncated"`
}

// StatusResponse tells any signed-in user whether text extraction is on.
type StatusResponse struct {
	Enabled bool `json:"enabled"`
}

// reader reads the text in pictures with one provider.
type reader func(ctx context.Context, images [][]byte) (*ExtractResponse, error)

func (s *Service) user(r *http.Request) (*store.User, error) {
	user, err := s.authenticator.AuthenticateToUser(r.Context(), r.Header.Get("Authorization"), r.Header.Get("Cookie"))
	if err != nil || user == nil {
		return nil, &httphandler.Error{Code: http.StatusUnauthorized, Message: "sign in to read text from files"}
	}
	return user, nil
}

func (s *Service) getStatus(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.user(r); err != nil {
		return err
	}
	settings, err := s.Load(r.Context())
	if err != nil {
		return err
	}
	read, err := s.readerFor(r.Context(), settings)
	if err != nil {
		return err
	}
	return httphandler.JSON(w, http.StatusOK, StatusResponse{Enabled: read != nil})
}

func (s *Service) extract(w http.ResponseWriter, r *http.Request) error {
	// Each extraction is paid for with the instance's key, so another site
	// must not be able to start one with the session cookie alone.
	if auth.ExtractBearerToken(r.Header.Get("Authorization")) == "" {
		return &httphandler.Error{Code: http.StatusUnauthorized, Message: "sign in to read text from files"}
	}
	user, err := s.user(r)
	if err != nil {
		return err
	}
	request := ExtractRequest{}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxExtractBody)).Decode(&request); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return &httphandler.Error{Code: http.StatusRequestEntityTooLarge, Message: "this file is too large to read at once"}
		}
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid request body", Cause: err}
	}
	decoded, err := decodeImages(request.Images)
	if err != nil {
		return err
	}
	if err := s.checkAttachment(r.Context(), user, request.Attachment); err != nil {
		return err
	}
	settings, err := s.Load(r.Context())
	if err != nil {
		return err
	}
	read, err := s.readerFor(r.Context(), settings)
	if err != nil {
		return err
	}
	if read == nil {
		return &httphandler.Error{Code: http.StatusConflict, Message: "text extraction is turned off; an admin can turn it on in Settings > AI"}
	}

	key := strconv.Itoa(int(user.ID))
	decision := s.limiter().Consume(rateLimitScope, key, 1)
	if !decision.Allowed {
		w.Header().Set("Retry-After", strconv.Itoa(max(int(decision.RetryAfter.Seconds()+0.5), 1)))
		return &httphandler.Error{Code: http.StatusTooManyRequests, Message: "you have read text from many files in the last hour; try again later"}
	}
	ctx, cancel := context.WithTimeout(r.Context(), extractTimeout)
	defer cancel()
	result, err := read(ctx, decoded)
	if err != nil {
		// A failed call wasn't an extraction: give it back.
		s.limiter().Refund(rateLimitScope, key, 1)
		return err
	}
	return httphandler.JSON(w, http.StatusOK, result)
}

// decodeImages checks the pictures and returns their bytes.
func decodeImages(images []ExtractImage) ([][]byte, error) {
	if len(images) == 0 {
		return nil, &httphandler.Error{Code: http.StatusBadRequest, Message: "there is nothing to read"}
	}
	if len(images) > MaxImages {
		return nil, &httphandler.Error{Code: http.StatusBadRequest, Message: "this file has too many pages to read at once; at most " + strconv.Itoa(MaxImages) + " scanned pages"}
	}
	decoded := make([][]byte, len(images))
	total := 0
	for i, image := range images {
		if !mediaTypes[image.MediaType] {
			return nil, &httphandler.Error{Code: http.StatusBadRequest, Message: "only PNG, JPEG, WebP and GIF pictures can be read"}
		}
		data, err := base64.StdEncoding.DecodeString(image.Data)
		if err != nil || len(data) == 0 {
			return nil, &httphandler.Error{Code: http.StatusBadRequest, Message: "a picture could not be read", Cause: err}
		}
		if len(data) > MaxImageBytes {
			return nil, &httphandler.Error{Code: http.StatusRequestEntityTooLarge, Message: "a picture is too large to read"}
		}
		total += len(data)
		decoded[i] = data
	}
	if total > maxImagesBytes {
		return nil, &httphandler.Error{Code: http.StatusRequestEntityTooLarge, Message: "this file is too large to read at once"}
	}
	return decoded, nil
}

// checkAttachment makes sure the user can read the file the pictures come
// from, under the same rules as the file server. An attachment the user can't
// see is "not found", as it is there.
func (s *Service) checkAttachment(ctx context.Context, user *store.User, name string) error {
	notFound := &httphandler.Error{Code: http.StatusNotFound, Message: "attachment not found"}
	uid, ok := strings.CutPrefix(name, "attachments/")
	if !ok || uid == "" || strings.Contains(uid, "/") {
		return notFound
	}
	attachment, err := s.Store.GetAttachment(ctx, &store.FindAttachment{UID: &uid})
	if err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to get attachment", Cause: err}
	}
	if attachment == nil {
		return notFound
	}
	if !strings.HasPrefix(attachment.Type, "image/") && attachment.Type != "application/pdf" {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "text can be read only from images, drawings and PDFs"}
	}
	if attachment.MemoID == nil {
		if !access.CanManageAttachment(user, attachment) {
			return notFound
		}
		return nil
	}
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{ID: attachment.MemoID})
	if err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to find memo", Cause: err}
	}
	if memo == nil {
		return notFound
	}
	allowAnonymous, err := s.Store.AllowsAnonymousAccess(ctx)
	if err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to get instance access policy", Cause: err}
	}
	facts, err := access.ResolveMemoReadFacts(ctx, s.Store, memo)
	if err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to resolve memo access", Cause: err}
	}
	readContext, err := facts.WithViewer(ctx, s.Store, user, allowAnonymous, nil)
	if err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to resolve memo access", Cause: err}
	}
	if !access.CheckMemoReadContext(readContext).Allowed() {
		return notFound
	}
	return nil
}

// readerFor returns the chosen provider's reader, or nil when extraction is
// off or its provider is gone. It makes no request.
func (s *Service) readerFor(ctx context.Context, settings *Settings) (reader, error) {
	switch settings.ProviderID {
	case "":
		return nil, nil
	case ProviderClaude:
		if settings.Claude == nil {
			return nil, nil
		}
		client, err := anthropic.New(settings.Claude.Endpoint, settings.Claude.APIKey, s.extractClient())
		if err != nil {
			return nil, &httphandler.Error{Code: http.StatusInternalServerError, Message: "the saved Claude connection is not valid", Cause: err}
		}
		model := modelOr(settings.Model, anthropic.DefaultModel)
		return func(ctx context.Context, decoded [][]byte) (*ExtractResponse, error) {
			images := make([]anthropic.Image, len(decoded))
			for i, data := range decoded {
				images[i] = anthropic.Image{MediaType: detectedType(data), Data: data}
			}
			result, err := client.ReadText(ctx, anthropic.TextRequest{Model: model, Instructions: Instructions, Images: images, MaxTokens: maxAnswerTokens})
			if err != nil {
				return nil, claudeError(err)
			}
			return answer(result.Text, result.Truncated, len(decoded)), nil
		}, nil
	}
	provider, err := s.geminiProvider(ctx, settings.ProviderID)
	if err != nil || provider == nil {
		return nil, err
	}
	client, err := geminivision.New(provider.GetEndpoint(), provider.GetApiKey(), s.extractClient())
	if err != nil {
		return nil, &httphandler.Error{Code: http.StatusInternalServerError, Message: "the Gemini provider's settings are not valid", Cause: err}
	}
	model := modelOr(settings.Model, geminivision.DefaultModel)
	return func(ctx context.Context, decoded [][]byte) (*ExtractResponse, error) {
		images := make([]geminivision.Image, len(decoded))
		for i, data := range decoded {
			images[i] = geminivision.Image{MediaType: detectedType(data), Data: data}
		}
		result, err := client.ReadText(ctx, geminivision.TextRequest{Model: model, Instructions: Instructions, Images: images, MaxTokens: maxAnswerTokens})
		if err != nil {
			return nil, geminiError(err)
		}
		return answer(result.Text, result.Truncated, len(decoded)), nil
	}, nil
}

// answer splits the AI's text at the page breaks.
func answer(text string, truncated bool, images int) *ExtractResponse {
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	pages := []string{}
	current := []string{}
	for _, line := range lines {
		if strings.TrimSpace(line) == PageBreak {
			pages = append(pages, strings.TrimSpace(strings.Join(current, "\n")))
			current = current[:0]
			continue
		}
		current = append(current, line)
	}
	pages = append(pages, strings.TrimSpace(strings.Join(current, "\n")))
	// A break before the first page or after the last one leaves an empty part.
	if len(pages) > images && pages[len(pages)-1] == "" {
		pages = pages[:len(pages)-1]
	}
	if len(pages) > images && pages[0] == "" {
		pages = pages[1:]
	}
	nonEmpty := make([]string, 0, len(pages))
	for _, page := range pages {
		if page != "" {
			nonEmpty = append(nonEmpty, page)
		}
	}
	response := &ExtractResponse{Text: strings.Join(nonEmpty, "\n\n"), Truncated: truncated, Pages: []string{}}
	if len(pages) == images {
		response.Pages = pages
	}
	return response
}

// geminiProvider returns the instance's Gemini provider with a key, or nil.
func (s *Service) geminiProvider(ctx context.Context, id string) (*storepb.AIProviderConfig, error) {
	aiSetting, err := s.Store.GetInstanceAISetting(ctx)
	if err != nil {
		return nil, &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to read the AI providers", Cause: err}
	}
	for _, provider := range aiSetting.GetProviders() {
		if provider.GetId() == id && provider.GetType() == storepb.AIProviderType_GEMINI && provider.GetApiKey() != "" {
			return provider, nil
		}
	}
	return nil, nil
}

// detectedType is the picture's type from its bytes, so a mislabeled picture
// doesn't make the provider refuse the request.
func detectedType(data []byte) string {
	detected := http.DetectContentType(data)
	if mediaTypes[detected] {
		return detected
	}
	return "image/png"
}

func modelOr(model, fallback string) string {
	if model = strings.TrimSpace(model); model != "" {
		return model
	}
	return fallback
}

func (s *Service) extractClient() *http.Client {
	if s.HTTPClient != nil {
		return s.HTTPClient
	}
	return safehttp.NewClient(extractTimeout)
}

func (s *Service) limiter() ratelimit.Limiter {
	s.limiterOnce.Do(func() {
		if s.Limiter == nil {
			s.Limiter = ratelimit.NewMemoryLimiter(ratelimit.Policy{rateLimitScope: rateLimitRule})
		}
	})
	return s.Limiter
}

// geminiService describes Gemini to safehttp's error explanations.
var geminiService = safehttp.Service{
	Name:        "Gemini",
	ExampleHost: "generativelanguage.googleapis.com",
	DefaultPort: "443",
	KeyHelp:     "Check the Gemini provider's API key in Settings > AI.",
}

// geminiError says what went wrong talking to Gemini, never with the key.
func geminiError(err error) error {
	for _, detailed := range []error{geminivision.ErrBadRequest, geminivision.ErrNotFound, geminivision.ErrBlocked} {
		if errors.Is(err, detailed) {
			return &httphandler.Error{Code: http.StatusBadGateway, Message: err.Error() + ".", Cause: err}
		}
	}
	for _, known := range []error{geminivision.ErrUnauthorized, geminivision.ErrRateLimited, geminivision.ErrOverloaded} {
		if errors.Is(err, known) {
			return &httphandler.Error{Code: http.StatusBadGateway, Message: known.Error() + ".", Cause: err}
		}
	}
	return &httphandler.Error{Code: http.StatusBadGateway, Message: safehttp.Explain(err, geminiService), Cause: err}
}
