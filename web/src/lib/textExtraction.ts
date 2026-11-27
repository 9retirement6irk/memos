import { apiJSON } from "./journal/api";

/** The model an Anthropic provider uses when none is set: it reads text well and is the cheapest and fastest. */
export const DEFAULT_CLAUDE_MODEL = "claude-haiku-5-5";

/** The text extraction settings: which of the instance's AI providers reads the text, and with which model. */
export interface TextExtractionSettings {
  providerId: string;
  model: string;
}

const BASE = "/api/text-extraction";

export const getTextExtractionSettings = () => apiJSON<TextExtractionSettings>(`${BASE}/settings`);

export const saveTextExtractionChoice = (providerId: string, model: string) =>
  apiJSON<TextExtractionSettings>(`${BASE}/settings`, { method: "PUT", body: JSON.stringify({ providerId, model }) });

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
