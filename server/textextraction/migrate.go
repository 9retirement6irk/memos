package textextraction

import (
	"context"
	"strings"

	"github.com/lithammer/shortuuid/v4"
	"github.com/pkg/errors"

	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/provider/ai"
	"github.com/usememos/memos/provider/ai/anthropic"
	"github.com/usememos/memos/store"
)

// MoveClaudeConnection moves the Claude connection the fork used to keep into
// the instance's AI providers, as an Anthropic provider named "Claude", now
// that stock Memos has them. What Claude was used for moves with it:
//
//   - text extraction that named the connection names the provider instead;
//   - tag suggestions Claude answered become the instance's text generation
//     setting, unless one is already chosen.
//
// It runs when the server starts and does nothing once the connection is
// moved. A provider that already has the same key and endpoint is used rather
// than added again, so a run that was cut short between its two writes is
// finished by the next one.
func MoveClaudeConnection(ctx context.Context, st *store.Store) error {
	settings := &Settings{}
	if _, err := st.GetForkSetting(ctx, store.ForkSettingTextExtraction, settings); err != nil {
		return errors.Wrap(err, "failed to read the text extraction settings")
	}
	legacy := settings.Claude
	if legacy == nil {
		// Nothing to move. A choice that still names the connection is of no use.
		if settings.ProviderID != legacyProviderClaude && settings.TagSuggestionModel == "" {
			return nil
		}
		if settings.ProviderID == legacyProviderClaude {
			settings.ProviderID = ""
		}
		settings.TagSuggestionModel = ""
		return errors.Wrap(st.UpsertForkSetting(ctx, store.ForkSettingTextExtraction, settings), "failed to save the text extraction settings")
	}

	aiSetting, err := st.GetInstanceAISetting(ctx)
	if err != nil {
		return err
	}
	// The provider list keeps the default endpoint as an empty one.
	endpoint := strings.TrimRight(strings.TrimSpace(legacy.Endpoint), "/")
	if endpoint == anthropic.DefaultEndpoint {
		endpoint = ""
	}
	providerID := ""
	for _, provider := range aiSetting.GetProviders() {
		if provider.GetType() == storepb.AIProviderType_ANTHROPIC && provider.GetApiKey() == legacy.APIKey && provider.GetEndpoint() == endpoint {
			providerID = provider.GetId()
			break
		}
	}
	changed := false
	if providerID == "" {
		providerID = shortuuid.New()
		aiSetting.Providers = append(aiSetting.Providers, &storepb.AIProviderConfig{
			Id:       providerID,
			Title:    "Claude",
			Type:     storepb.AIProviderType_ANTHROPIC,
			Endpoint: endpoint,
			ApiKey:   legacy.APIKey,
		})
		changed = true
	}
	if settings.TagSuggestionModel != "" && aiSetting.GetTextGeneration().GetProviderId() == "" {
		aiSetting.TextGeneration = &storepb.TextGenerationConfig{ProviderId: providerID, Model: settings.TagSuggestionModel}
		changed = true
	}
	if changed {
		if err := ai.ValidateSetting(aiSetting); err != nil {
			return errors.Wrap(err, "the AI setting with Claude added is not valid")
		}
		if _, err := st.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
			Key:   storepb.InstanceSettingKey_AI,
			Value: &storepb.InstanceSetting_AiSetting{AiSetting: aiSetting},
		}); err != nil {
			return errors.Wrap(err, "failed to save the AI setting")
		}
	}

	if settings.ProviderID == legacyProviderClaude {
		settings.ProviderID = providerID
	}
	settings.Claude = nil
	settings.TagSuggestionModel = ""
	return errors.Wrap(st.UpsertForkSetting(ctx, store.ForkSettingTextExtraction, settings), "failed to save the text extraction settings")
}
