// Package textextraction serves /api/text-extraction: reading the text out of
// images, drawings and PDFs with Claude or Gemini, and the settings for it.
//
// The setting is which of the instance's AI providers (Settings > AI) reads
// the text, and with which model: an Anthropic or a Gemini one, the kinds that
// read images. Only admins can see or change it. The provider and its API key
// are stock Memos' own; this package only names the provider by its ID.
//
// Any signed-in user can ask for the text in an attachment they can read
// (POST /extract). The browser prepares the pictures: it scales images down,
// reads a PDF's own text layer itself and renders only its scanned pages.
// Each user may ask 30 times an hour, since every call is paid for with the
// instance's key.
//
// The choice lives in the fork's own system_setting row
// (store.ForkSettingTextExtraction), which stock Memos ignores, so going back
// to stock Memos is unaffected.
//
// Before stock Memos had Anthropic providers, the fork kept a Claude connection
// of its own in that row. MoveClaudeConnection moves one into the provider list.
package textextraction

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/httphandler"
	"github.com/usememos/memos/internal/ratelimit"
	"github.com/usememos/memos/internal/safehttp"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/provider/ai/anthropic"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
)

const (
	// legacyProviderClaude named the fork's own Claude connection as the
	// extraction provider, before MoveClaudeConnection.
	legacyProviderClaude = "claude"
	// maxRequestBytes bounds a settings update.
	maxRequestBytes = 16 << 10
	// maxModelLength matches the transcription model's limit.
	maxModelLength = 256
)

// claudeService describes Claude to safehttp's error explanations.
var claudeService = safehttp.Service{
	Name:        "Claude",
	ExampleHost: "api.anthropic.com",
	DefaultPort: "443",
	KeyHelp:     "Check the Anthropic provider's API key in Settings > AI.",
}

// LegacyClaudeConnection is the Claude connection the fork used to keep.
type LegacyClaudeConnection struct {
	Endpoint string `json:"endpoint"`
	APIKey   string `json:"apiKey"`
}

// Settings is the stored document.
type Settings struct {
	// ProviderID is one of the instance's AI providers; empty turns extraction off.
	ProviderID string `json:"providerId"`
	// Model is the provider's model; empty uses the default for its kind.
	Model string `json:"model"`
	// Claude and TagSuggestionModel are from before stock Memos had Anthropic
	// providers. They are only read by MoveClaudeConnection, which clears them.
	Claude             *LegacyClaudeConnection `json:"claude,omitempty"`
	TagSuggestionModel string                  `json:"tagSuggestionModel,omitempty"`
}

// SettingsResponse is what an admin sees of the settings.
type SettingsResponse struct {
	ProviderID string `json:"providerId"`
	Model      string `json:"model"`
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
	return httphandler.JSON(w, http.StatusOK, SettingsResponse{ProviderID: settings.ProviderID, Model: settings.Model})
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
	if err := s.checkProvider(r.Context(), providerID); err != nil {
		return err
	}
	settings.ProviderID = providerID
	settings.Model = model
	if err := s.save(r.Context(), settings); err != nil {
		return err
	}
	return respond(w, settings)
}

// readsImages reports whether a provider of this type can read text out of
// pictures here: Anthropic's Messages API and Gemini can.
func readsImages(providerType storepb.AIProviderType) bool {
	switch providerType {
	case storepb.AIProviderType_GEMINI, storepb.AIProviderType_ANTHROPIC, storepb.AIProviderType_ANTHROPIC_COMPATIBLE:
		return true
	default:
		return false
	}
}

// checkProvider accepts no provider, or one of the instance's Anthropic or
// Gemini providers: those are the ones that can read images and PDFs.
func (s *Service) checkProvider(ctx context.Context, providerID string) error {
	if providerID == "" {
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
		if !readsImages(provider.GetType()) {
			return &httphandler.Error{Code: http.StatusBadRequest, Message: "this provider can't read images; choose an Anthropic or a Gemini provider"}
		}
		return nil
	}
	return &httphandler.Error{Code: http.StatusBadRequest, Message: "that AI provider no longer exists"}
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
