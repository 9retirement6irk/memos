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
  /** Whether Claude answers tag suggestions, in place of the text generation provider, and with which model. */
  tagSuggestions: { claude: boolean; model: string };
}

const BASE = "/api/text-extraction";

export const getTextExtractionSettings = () => apiJSON<TextExtractionSettings>(`${BASE}/settings`);

/** Saves the Claude connection; the server checks the key first. An empty key keeps the saved one. */
export const saveClaudeConnection = (endpoint: string, apiKey: string) =>
  apiJSON<TextExtractionSettings>(`${BASE}/claude`, { method: "PUT", body: JSON.stringify({ endpoint, apiKey }) });

export const deleteClaudeConnection = () => apiJSON<TextExtractionSettings>(`${BASE}/claude`, { method: "DELETE" });

export const saveTextExtractionChoice = (providerId: string, model: string) =>
  apiJSON<TextExtractionSettings>(`${BASE}/settings`, { method: "PUT", body: JSON.stringify({ providerId, model }) });

/** Turns Claude on or off for tag suggestions. On with no model uses the default one. */
export const saveClaudeTagSuggestions = (claude: boolean, model: string) =>
  apiJSON<TextExtractionSettings>(`${BASE}/tag-suggestions`, { method: "PUT", body: JSON.stringify({ claude, model }) });

/** The most pictures one request may carry, and the largest picture, as the server allows. */
export const MAX_EXTRACT_IMAGES = 20;
export const MAX_EXTRACT_IMAGE_BYTES = 3_750_000;

/** One picture to read, base64-encoded. */
export interface ExtractImage {
  mediaType: string;
  data: string;
}

/** The text the AI read: all of it, and each picture's part when the answer could be split by picture. */
export interface ExtractResult {
  text: string;
  pages: string[];
  truncated: boolean;
}

/** Whether text extraction is on, for any signed-in user. */
export const getTextExtractionStatus = () => apiJSON<{ enabled: boolean }>(`${BASE}/status`);

/** Asks the chosen AI for the text in the pictures of one attachment, which the user must be able to read. */
export const extractText = (attachment: string, images: ExtractImage[], signal?: AbortSignal) =>
  apiJSON<ExtractResult>(`${BASE}/extract`, { method: "POST", body: JSON.stringify({ attachment, images }), signal });
