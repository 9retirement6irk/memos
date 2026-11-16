import { apiJSON } from "./journal/api";

/** The provider ID that names the instance's own Claude connection. Other IDs name one of the AI providers. */
export const CLAUDE_PROVIDER = "claude";

/** The model Claude uses when none is set: it reads text well and is the cheapest and fastest. */
export const DEFAULT_CLAUDE_MODEL = "claude-haiku-5-5";

/** What an admin sees of the text extraction settings: never the Claude key, only a hint. */
export interface TextExtractionSettings {
  claude: { configured: boolean; endpoint: string; apiKeyHint: string };
  providerId: string;
  model: string;
}

const BASE = "/api/text-extraction";

export const getTextExtractionSettings = () => apiJSON<TextExtractionSettings>(`${BASE}/settings`);

/** Saves the Claude connection; the server checks the key first. An empty key keeps the saved one. */
export const saveClaudeConnection = (endpoint: string, apiKey: string) =>
  apiJSON<TextExtractionSettings>(`${BASE}/claude`, { method: "PUT", body: JSON.stringify({ endpoint, apiKey }) });

export const deleteClaudeConnection = () => apiJSON<TextExtractionSettings>(`${BASE}/claude`, { method: "DELETE" });

export const saveTextExtractionChoice = (providerId: string, model: string) =>
  apiJSON<TextExtractionSettings>(`${BASE}/settings`, { method: "PUT", body: JSON.stringify({ providerId, model }) });
