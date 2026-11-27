import { useTextExtractionSettings, useUpdateTextExtraction } from "@/hooks/useTextExtractionQueries";
import { CLAUDE_PROVIDER } from "@/lib/textExtraction";

/** The address Claude is called at when none is given. */
export const CLAUDE_DEFAULT_ENDPOINT = "https://api.anthropic.com";

/**
 * The fork's Claude connection, for the AI settings to list beside the stock providers.
 *
 * Claude is not a stock provider: the store's provider list has only OpenAI and Gemini, and
 * the database stays stock, so the connection and what it is used for live in a settings row
 * of the fork's own (server/textextraction). The settings page shows it as one more provider
 * all the same: a row in the provider list, a type in the provider dialog, and a choice for
 * tag suggestions. It can't transcribe, so it isn't offered there.
 */
export const useClaudeProvider = () => {
  const { data: settings } = useTextExtractionSettings();
  const { saveClaude, removeClaude, saveTagSuggestions } = useUpdateTextExtraction();
  const connected = Boolean(settings?.claude.configured);
  return {
    /** The id Claude goes by among the providers. */
    id: CLAUDE_PROVIDER,
    /** False until the settings load, which they only do for an admin. */
    loaded: Boolean(settings),
    connected,
    endpoint: connected ? (settings?.claude.endpoint ?? "") : "",
    apiKeyHint: connected ? (settings?.claude.apiKeyHint ?? "") : "",
    /** Whether Claude reads text out of images, drawings and PDFs. */
    readsText: connected && settings?.providerId === CLAUDE_PROVIDER,
    /** The model that answers tag suggestions, when Claude does. */
    tagModel: connected && settings?.tagSuggestions.claude ? settings.tagSuggestions.model : undefined,
    busy: saveClaude.isPending || removeClaude.isPending || saveTagSuggestions.isPending,
    /** Connects Claude, or changes the connection; an empty key keeps the stored one. The server checks it with Anthropic first. */
    save: (endpoint: string, apiKey: string) => saveClaude.mutateAsync({ endpoint, apiKey }),
    remove: () => removeClaude.mutateAsync(),
    /** Has Claude answer tag suggestions with `model`, or stop when it is undefined. */
    setTagModel: (model: string | undefined) => saveTagSuggestions.mutateAsync({ claude: model !== undefined, model: model ?? "" }),
  };
};
