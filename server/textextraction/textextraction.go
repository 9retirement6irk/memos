// Package textextraction serves /api/text-extraction: reading the text out of
// images, drawings and PDFs with Claude or Gemini, and the settings for it.
//
// The settings are the instance's Claude connection, its choice of AI for
// reading text, and whether Claude answers tag suggestions (TagSuggestionProvider).
// Only admins can see or change them. The Claude API key stays on the server:
// responses carry only whether it is set and a masked hint.
//
// Any signed-in user can ask for the text in an attachment they can read
// (POST /extract). The browser prepares the pictures: it scales images down,
// reads a PDF's own text layer itself and renders only its scanned pages.
// Each user may ask 30 times an hour, since every call is paid for with the
// instance's key.
//
// The settings live in the fork's own system_setting row
// (store.ForkSettingTextExtraction), which stock Memos ignores, not in stock's
// AI provider list, so going back to stock Memos is unaffected.
package textextraction

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/httphandler"
	"github.com/usememos/memos/internal/ratelimit"
	"github.com/usememos/memos/internal/safehttp"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/provider/ai"
	"github.com/usememos/memos/provider/ai/anthropic"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
)

const (
	// ProviderClaude names the fork's Claude connection as the extraction provider.
	// Any other non-empty provider ID names one of the instance's AI providers.
	ProviderClaude = "claude"
	// maxRequestBytes bounds a settings update.
	maxRequestBytes = 16 << 10
	// maxModelLength matches the transcription model's limit.
	maxModelLength = 256
	// requestTimeout bounds a call to Claude from these routes.
	requestTimeout = 30 * time.Second
)

// claudeService describes Claude to safehttp's error explanations.
var claudeService = safehttp.Service{
	Name:        "Claude",
	ExampleHost: "api.anthropic.com",
	DefaultPort: "443",
	KeyHelp:     "Copy a key again from the Anthropic Console.",
}

// ClaudeConnection is what the store keeps for Claude.
type ClaudeConnection struct {
	Endpoint string `json:"endpoint"`
	APIKey   string `json:"apiKey"`
}

// Settings is the stored document.
type Settings struct {
	Claude     *ClaudeConnection `json:"claude,omitempty"`
	ProviderID string            `json:"providerId"`
	Model      string            `json:"model"`
	// TagSuggestionModel is the Claude model that answers tag suggestions.
	// Empty leaves them to the instance's text generation setting.
	TagSuggestionModel string `json:"tagSuggestionModel,omitempty"`
}

// ClaudeResponse is what an admin sees of the Claude connection: never the key.
type ClaudeResponse struct {
	Configured bool   `json:"configured"`
	Endpoint   string `json:"endpoint"`
	APIKeyHint string `json:"apiKeyHint"`
}

// TagSuggestions says whether Claude answers tag suggestions, and with which model.
type TagSuggestions struct {
	Claude bool   `json:"claude"`
	Model  string `json:"model"`
}

// SettingsResponse is what an admin sees of the settings.
type SettingsResponse struct {
	Claude         ClaudeResponse `json:"claude"`
	ProviderID     string         `json:"providerId"`
	Model          string         `json:"model"`
	TagSuggestions TagSuggestions `json:"tagSuggestions"`
}

// ClaudeRequest updates the Claude connection. An empty APIKey keeps the saved
// one, as long as Endpoint is still the one it was saved for.
type ClaudeRequest struct {
	Endpoint string `json:"endpoint"`
	APIKey   string `json:"apiKey"`
}

// ChoiceRequest chooses the provider and model for text extraction.
type ChoiceRequest struct {
	ProviderID string `json:"providerId"`
	Model      string `json:"model"`
}

// Service handles the /api/text-extraction routes.
type Service struct {
	Store         *store.Store
	authenticator *auth.Authenticator
	// HTTPClient calls Claude and Gemini; nil uses a client that refuses
	// private addresses. Tests replace it to reach a fake server on loopback.
	HTTPClient *http.Client
	// Limiter counts each user's extractions; nil makes an in-memory one on
	// first use.
	Limiter     ratelimit.Limiter
	limiterOnce sync.Once
}

// NewService returns the service for the store and the instance secret.
func NewService(store *store.Store, secret string) *Service {
	return &Service{Store: store, authenticator: auth.NewAuthenticator(store, secret)}
}

// RegisterRoutes adds the /api/text-extraction routes to mux.
func (s *Service) RegisterRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/text-extraction/settings", httphandler.Func(s.getSettings))
	mux.Handle("PUT /api/text-extraction/settings", httphandler.Func(s.putChoice))
	mux.Handle("PUT /api/text-extraction/claude", httphandler.Func(s.putClaude))
	mux.Handle("DELETE /api/text-extraction/claude", httphandler.Func(s.deleteClaude))
	mux.Handle("PUT /api/text-extraction/tag-suggestions", httphandler.Func(s.putTagSuggestions))
	mux.Handle("GET /api/text-extraction/status", httphandler.Func(s.getStatus))
	mux.Handle("POST /api/text-extraction/extract", httphandler.Func(s.extract))
}

var (
	errNotSignedIn = &httphandler.Error{Code: http.StatusUnauthorized, Message: "sign in to change text extraction"}
	errNotAdmin    = &httphandler.Error{Code: http.StatusForbidden, Message: "only an admin can change text extraction"}
)

// admin returns the signed-in admin. A change also needs a Bearer token, so
// another site can't make a signed-in browser change settings with the
// session cookie alone.
func (s *Service) admin(r *http.Request, change bool) (*store.User, error) {
	if change && auth.ExtractBearerToken(r.Header.Get("Authorization")) == "" {
		return nil, errNotSignedIn
	}
	user, err := s.authenticator.AuthenticateToUser(r.Context(), r.Header.Get("Authorization"), r.Header.Get("Cookie"))
	if err != nil || user == nil {
		return nil, errNotSignedIn
	}
	if user.Role != store.RoleAdmin {
		return nil, errNotAdmin
	}
	return user, nil
}

// Load returns the saved settings, or empty ones.
func (s *Service) Load(ctx context.Context) (*Settings, error) {
	settings := &Settings{}
	if _, err := s.Store.GetForkSetting(ctx, store.ForkSettingTextExtraction, settings); err != nil {
		return nil, &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to read the text extraction settings", Cause: err}
	}
	return settings, nil
}

func (s *Service) save(ctx context.Context, settings *Settings) error {
	if err := s.Store.UpsertForkSetting(ctx, store.ForkSettingTextExtraction, settings); err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to save the text extraction settings", Cause: err}
	}
	return nil
}

func respond(w http.ResponseWriter, settings *Settings) error {
	response := SettingsResponse{ProviderID: settings.ProviderID, Model: settings.Model}
	if settings.Claude != nil {
		response.Claude = ClaudeResponse{Configured: true, Endpoint: settings.Claude.Endpoint, APIKeyHint: maskAPIKey(settings.Claude.APIKey)}
		response.TagSuggestions = TagSuggestions{Claude: settings.TagSuggestionModel != "", Model: settings.TagSuggestionModel}
	}
	return httphandler.JSON(w, http.StatusOK, response)
}

func (s *Service) getSettings(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.admin(r, false); err != nil {
		return err
	}
	settings, err := s.Load(r.Context())
	if err != nil {
		return err
	}
	return respond(w, settings)
}

func (s *Service) putClaude(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.admin(r, true); err != nil {
		return err
	}
	request := ClaudeRequest{}
	if err := json.NewDecoder(io.LimitReader(r.Body, maxRequestBytes)).Decode(&request); err != nil {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid request body", Cause: err}
	}
	settings, err := s.Load(r.Context())
	if err != nil {
		return err
	}
	apiKey := strings.TrimSpace(request.APIKey)
	if apiKey == "" {
		if settings.Claude == nil {
			return &httphandler.Error{Code: http.StatusBadRequest, Message: "enter your Anthropic API key"}
		}
		// The saved key is never sent to an endpoint other than the one it
		// was saved for.
		endpoint, err := anthropic.NormalizeEndpoint(request.Endpoint)
		if err != nil {
			return &httphandler.Error{Code: http.StatusBadRequest, Message: err.Error()}
		}
		if !safehttp.SameServer(settings.Claude.Endpoint, endpoint) {
			return &httphandler.Error{Code: http.StatusBadRequest, Message: "enter the API key again to use a different endpoint"}
		}
		apiKey = settings.Claude.APIKey
	}
	client, err := anthropic.New(request.Endpoint, apiKey, s.httpClient())
	if err != nil {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: err.Error()}
	}
	// Save only a key that works.
	ctx, cancel := context.WithTimeout(r.Context(), requestTimeout)
	defer cancel()
	if err := client.Check(ctx); err != nil {
		return claudeError(err)
	}
	settings.Claude = &ClaudeConnection{Endpoint: client.Endpoint(), APIKey: apiKey}
	if err := s.save(r.Context(), settings); err != nil {
		return err
	}
	return respond(w, settings)
}

func (s *Service) deleteClaude(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.admin(r, true); err != nil {
		return err
	}
	settings, err := s.Load(r.Context())
	if err != nil {
		return err
	}
	settings.Claude = nil
	// Extraction and tag suggestions can't use a connection that is gone.
	if settings.ProviderID == ProviderClaude {
		settings.ProviderID = ""
	}
	settings.TagSuggestionModel = ""
	if err := s.save(r.Context(), settings); err != nil {
		return err
	}
	return respond(w, settings)
}

func (s *Service) putChoice(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.admin(r, true); err != nil {
		return err
	}
	request := ChoiceRequest{}
	if err := json.NewDecoder(io.LimitReader(r.Body, maxRequestBytes)).Decode(&request); err != nil {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid request body", Cause: err}
	}
	providerID := strings.TrimSpace(request.ProviderID)
	model := strings.TrimSpace(request.Model)
	if len(model) > maxModelLength {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "the model name is too long"}
	}
	settings, err := s.Load(r.Context())
	if err != nil {
		return err
	}
	if err := s.checkProvider(r.Context(), settings, providerID); err != nil {
		return err
	}
	settings.ProviderID = providerID
	settings.Model = model
	if err := s.save(r.Context(), settings); err != nil {
		return err
	}
	return respond(w, settings)
}

// putTagSuggestions turns Claude on or off for tag suggestions. On, with no
// model named, it uses the default one.
func (s *Service) putTagSuggestions(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.admin(r, true); err != nil {
		return err
	}
	request := TagSuggestions{}
	if err := json.NewDecoder(io.LimitReader(r.Body, maxRequestBytes)).Decode(&request); err != nil {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid request body", Cause: err}
	}
	model := strings.TrimSpace(request.Model)
	if len(model) > maxModelLength {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "the model name is too long"}
	}
	settings, err := s.Load(r.Context())
	if err != nil {
		return err
	}
	switch {
	case !request.Claude:
		model = ""
	case settings.Claude == nil:
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "connect Claude first"}
	case model == "":
		model = anthropic.DefaultModel
	default:
		// On with a model named: it is kept as typed.
	}
	settings.TagSuggestionModel = model
	if err := s.save(r.Context(), settings); err != nil {
		return err
	}
	return respond(w, settings)
}

// TagSuggestionProvider returns Claude as the provider that answers tag
// suggestions, and the model to ask, when an admin chose it and Claude is
// connected. Otherwise it reports false, and the instance's own text
// generation setting decides.
func TagSuggestionProvider(ctx context.Context, st *store.Store) (ai.ProviderConfig, string, bool, error) {
	settings := &Settings{}
	if _, err := st.GetForkSetting(ctx, store.ForkSettingTextExtraction, settings); err != nil {
		return ai.ProviderConfig{}, "", false, err
	}
	if settings.Claude == nil || settings.TagSuggestionModel == "" {
		return ai.ProviderConfig{}, "", false, nil
	}
	provider := ai.ProviderConfig{
		ID:       ProviderClaude,
		Title:    "Claude",
		Type:     ai.ProviderAnthropic,
		Endpoint: settings.Claude.Endpoint,
		APIKey:   settings.Claude.APIKey,
	}
	return provider, settings.TagSuggestionModel, true, nil
}

// checkProvider accepts no provider, Claude once it is connected, or one of the
// instance's Gemini providers: those are the ones that can read images and PDFs.
func (s *Service) checkProvider(ctx context.Context, settings *Settings, providerID string) error {
	switch providerID {
	case "":
		return nil
	case ProviderClaude:
		if settings.Claude == nil {
			return &httphandler.Error{Code: http.StatusBadRequest, Message: "connect Claude first"}
		}
		return nil
	}
	aiSetting, err := s.Store.GetInstanceAISetting(ctx)
	if err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to read the AI providers", Cause: err}
	}
	for _, provider := range aiSetting.GetProviders() {
		if provider.GetId() != providerID {
			continue
		}
		if provider.GetType() != storepb.AIProviderType_GEMINI {
			return &httphandler.Error{Code: http.StatusBadRequest, Message: "this provider can't read images; choose Claude or a Gemini provider"}
		}
		return nil
	}
	return &httphandler.Error{Code: http.StatusBadRequest, Message: "that AI provider no longer exists"}
}

func (s *Service) httpClient() *http.Client {
	if s.HTTPClient != nil {
		return s.HTTPClient
	}
	return safehttp.NewClient(requestTimeout)
}

// claudeError says what went wrong talking to Claude, never with the key.
func claudeError(err error) error {
	// These carry Anthropic's own explanation, such as which model is unknown.
	for _, detailed := range []error{anthropic.ErrBadRequest, anthropic.ErrRefused} {
		if errors.Is(err, detailed) {
			return &httphandler.Error{Code: http.StatusBadGateway, Message: err.Error() + ".", Cause: err}
		}
	}
	for _, known := range []error{anthropic.ErrUnauthorized, anthropic.ErrForbidden, anthropic.ErrNotFound, anthropic.ErrRateLimited, anthropic.ErrOverloaded} {
		if errors.Is(err, known) {
			return &httphandler.Error{Code: http.StatusBadGateway, Message: known.Error() + ".", Cause: err}
		}
	}
	return &httphandler.Error{Code: http.StatusBadGateway, Message: safehttp.Explain(err, claudeService), Cause: err}
}

// maskAPIKey shows the start and end of a key, as Memos does for its AI providers.
func maskAPIKey(apiKey string) string {
	if apiKey == "" {
		return ""
	}
	if len(apiKey) <= 8 {
		return "..."
	}
	return apiKey[:4] + "..." + apiKey[len(apiKey)-4:]
}
