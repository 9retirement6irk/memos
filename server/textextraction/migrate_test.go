package textextraction

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

// The Claude connection the fork used to keep becomes an Anthropic provider,
// and what it was used for follows it.
func TestMoveClaudeConnection(t *testing.T) {
	ctx := context.Background()
	env := newTestEnv(ctx, t, fakeClaude(t))
	load := func() *Settings {
		t.Helper()
		settings := &Settings{}
		_, err := env.store.GetForkSetting(ctx, store.ForkSettingTextExtraction, settings)
		require.NoError(t, err)
		return settings
	}
	save := func(settings *Settings) {
		t.Helper()
		require.NoError(t, env.store.UpsertForkSetting(ctx, store.ForkSettingTextExtraction, settings))
	}
	aiSetting := func() *storepb.InstanceAISetting {
		t.Helper()
		setting, err := env.store.GetInstanceAISetting(ctx)
		require.NoError(t, err)
		return setting
	}

	// Nothing saved: nothing happens.
	require.NoError(t, MoveClaudeConnection(ctx, env.store))
	require.Empty(t, aiSetting().GetProviders())

	setProviders(ctx, t, env, &storepb.AIProviderConfig{Id: "gemini-1", Title: "Gemini", Type: storepb.AIProviderType_GEMINI, ApiKey: "gemini-test-key"})
	save(&Settings{
		Claude:             &LegacyClaudeConnection{Endpoint: "https://api.anthropic.com", APIKey: goodKey},
		ProviderID:         "claude",
		Model:              "claude-sonnet-5-5",
		TagSuggestionModel: "claude-haiku-5-5",
	})
	require.NoError(t, MoveClaudeConnection(ctx, env.store))

	moved := aiSetting()
	require.Len(t, moved.GetProviders(), 2)
	require.Equal(t, "gemini-1", moved.GetProviders()[0].GetId())
	claude := moved.GetProviders()[1]
	require.NotEmpty(t, claude.GetId())
	require.Equal(t, "Claude", claude.GetTitle())
	require.Equal(t, storepb.AIProviderType_ANTHROPIC, claude.GetType())
	// Anthropic's own address is kept as the default, an empty endpoint.
	require.Empty(t, claude.GetEndpoint())
	require.Equal(t, goodKey, claude.GetApiKey())
	require.Equal(t, claude.GetId(), moved.GetTextGeneration().GetProviderId())
	require.Equal(t, "claude-haiku-5-5", moved.GetTextGeneration().GetModel())

	settings := load()
	require.Nil(t, settings.Claude)
	require.Empty(t, settings.TagSuggestionModel)
	require.Equal(t, claude.GetId(), settings.ProviderID)
	require.Equal(t, "claude-sonnet-5-5", settings.Model)
	// Text extraction goes on working with the provider.
	require.True(t, status(t, env, env.user))

	// A second run changes nothing.
	require.NoError(t, MoveClaudeConnection(ctx, env.store))
	require.Len(t, aiSetting().GetProviders(), 2)
	require.Equal(t, claude.GetId(), load().ProviderID)
}

// A run cut short after the provider was added is finished by the next one,
// without adding Claude twice, and a text generation choice already made stays.
func TestMoveClaudeConnectionFinishesAnInterruptedRun(t *testing.T) {
	ctx := context.Background()
	env := newTestEnv(ctx, t, fakeClaude(t))
	_, err := env.store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_AI,
		Value: &storepb.InstanceSetting_AiSetting{AiSetting: &storepb.InstanceAISetting{
			Providers: []*storepb.AIProviderConfig{
				{Id: "openai-1", Title: "OpenAI", Type: storepb.AIProviderType_OPENAI, ApiKey: "openai-test-key"},
				{Id: "claude-moved", Title: "Claude", Type: storepb.AIProviderType_ANTHROPIC, Endpoint: "https://claude.example.com", ApiKey: goodKey},
			},
			TextGeneration: &storepb.TextGenerationConfig{ProviderId: "openai-1", Model: "text-model"},
		}},
	})
	require.NoError(t, err)
	require.NoError(t, env.store.UpsertForkSetting(ctx, store.ForkSettingTextExtraction, &Settings{
		Claude:             &LegacyClaudeConnection{Endpoint: "https://claude.example.com/", APIKey: goodKey},
		ProviderID:         "claude",
		TagSuggestionModel: "claude-haiku-5-5",
	}))

	require.NoError(t, MoveClaudeConnection(ctx, env.store))
	setting, err := env.store.GetInstanceAISetting(ctx)
	require.NoError(t, err)
	require.Len(t, setting.GetProviders(), 2)
	require.Equal(t, "openai-1", setting.GetTextGeneration().GetProviderId())
	settings := &Settings{}
	_, err = env.store.GetForkSetting(ctx, store.ForkSettingTextExtraction, settings)
	require.NoError(t, err)
	require.Equal(t, "claude-moved", settings.ProviderID)
	require.Nil(t, settings.Claude)
}

// A choice that names a connection that is gone is cleared.
func TestMoveClaudeConnectionWithoutAConnection(t *testing.T) {
	ctx := context.Background()
	env := newTestEnv(ctx, t, fakeClaude(t))
	require.NoError(t, env.store.UpsertForkSetting(ctx, store.ForkSettingTextExtraction, &Settings{ProviderID: "claude", TagSuggestionModel: "claude-haiku-5-5"}))
	require.NoError(t, MoveClaudeConnection(ctx, env.store))
	settings := &Settings{}
	_, err := env.store.GetForkSetting(ctx, store.ForkSettingTextExtraction, settings)
	require.NoError(t, err)
	require.Equal(t, Settings{}, *settings)
	setting, err := env.store.GetInstanceAISetting(ctx)
	require.NoError(t, err)
	require.Empty(t, setting.GetProviders())
}
