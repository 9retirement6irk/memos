import type { PDFDocumentProxy } from "pdfjs-dist";
import { loadPdfjs } from "@/components/MemoMetadata/Attachment/pdfDocument";
import { decodeImage } from "./heic";
import { responseErrorMessage } from "./responseError";
import { type ExtractImage, type ExtractResult, MAX_EXTRACT_IMAGE_BYTES, MAX_EXTRACT_IMAGES } from "./textExtraction";

/**
 * The longest side a picture is sent at. Text stays legible, and a provider would scale a larger
 * picture down anyway, so more pixels would only cost upload time.
 */
export const MAX_SIDE = 2000;
/** A PDF page with at least this many letters of its own text is read here, with no AI. */
const MIN_TEXT_LAYER_CHARS = 16;
/** More pages than this aren't looked at: reading them all would take too long in the browser. */
const MAX_PDF_PAGES = 500;

/** A page of a file, ready to read: its own text, or a picture for the AI. */
export type PreparedPage = { kind: "text"; text: string } | { kind: "image"; image: ExtractImage };

/** A PDF with more scanned pages than one request can carry. */
export class TooManyPagesError extends Error {
  constructor(readonly limit: number) {
    super(`more than ${limit} pages to read`);
    this.name = "TooManyPagesError";
  }
}

/** The text items pdf.js finds on a page, joined with their line breaks. */
export const textFromItems = (items: ReadonlyArray<object>): string => {
  let text = "";
  for (const item of items) {
    if (!("str" in item) || typeof item.str !== "string") continue;
    text += item.str;
    if ("hasEOL" in item && item.hasEOL) text += "\n";
  }
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
};

/** Whether a page's own text is enough to stand for the page: a scanned page has none, or a few stray letters. */
export const hasTextLayer = (text: string): boolean => text.replace(/\s/g, "").length >= MIN_TEXT_LAYER_CHARS;

/** The pictures among the pages, in order: what goes to the AI. */
export const picturesOf = (pages: PreparedPage[]): ExtractImage[] => pages.flatMap((page) => (page.kind === "image" ? [page.image] : []));

/**
 * The whole file's text: each page's own text where it has one, and the AI's answer for the pictures. When the
 * answer came back split by picture, each part goes in its page's place; otherwise all of it goes where the first
 * picture was.
 */
export const assembleText = (pages: PreparedPage[], result?: Pick<ExtractResult, "text" | "pages">): string => {
  const pictures = pages.filter((page) => page.kind === "image").length;
  const byPicture = result && result.pages.length === pictures ? result.pages : undefined;
  const parts: string[] = [];
  let picture = 0;
  for (const page of pages) {
    if (page.kind === "text") {
      parts.push(page.text);
      continue;
    }
    if (byPicture) parts.push(byPicture[picture]);
    else if (picture === 0 && result) parts.push(result.text);
    picture += 1;
  }
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
};

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> =>
  new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("the picture could not be encoded"))), type, quality),
  );

const toBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

/** The scale that fits width × height within MAX_SIDE, never enlarging. */
export const fitScale = (width: number, height: number, maxSide = MAX_SIDE): number => Math.min(1, maxSide / Math.max(width, height, 1));

/**
 * Draws a picture at the given size on white (a transparent drawing reads as dark text on white) and encodes it as
 * a JPEG under the size the server takes, lowering the quality and then the size until it fits.
 */
const encode = async (draw: (context: CanvasRenderingContext2D, width: number, height: number) => void, width: number, height: number) => {
  let scale = 1;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("the picture could not be drawn");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    draw(context, canvas.width, canvas.height);
    for (const quality of [0.9, 0.75]) {
      const blob = await toBlob(canvas, "image/jpeg", quality);
      if (blob.size <= MAX_EXTRACT_IMAGE_BYTES) return { mediaType: "image/jpeg", data: await toBase64(blob) } satisfies ExtractImage;
    }
    scale *= 0.7;
  }
  throw new Error("the picture is too large to read");
};

/** An image or drawing from this server, scaled down to send. */
export const prepareImage = async (url: string, signal?: AbortSignal): Promise<PreparedPage[]> => {
  const response = await fetch(url, { credentials: "same-origin", signal });
  if (!response.ok) throw new Error(await responseErrorMessage(response));
  // A HEIC photo uploaded before conversion existed is decoded with libheif where the browser can't.
  const bitmap = await decodeImage(await response.blob());
  try {
    const scale = fitScale(bitmap.width, bitmap.height);
    const image = await encode(
      (context, width, height) => context.drawImage(bitmap, 0, 0, width, height),
      bitmap.width * scale,
      bitmap.height * scale,
    );
    return [{ kind: "image", image }];
  } finally {
    bitmap.close();
  }
};

/**
 * A PDF's pages: its own text where a page has it, and a picture of each page that doesn't (a scan). Only the
 * pictures go to the AI.
 */
export const preparePdfDocument = async (pdf: PDFDocumentProxy, signal?: AbortSignal): Promise<PreparedPage[]> => {
  if (pdf.numPages > MAX_PDF_PAGES) throw new TooManyPagesError(MAX_PDF_PAGES);
  const pages: PreparedPage[] = [];
  let pictures = 0;
  for (let number = 1; number <= pdf.numPages; number += 1) {
    signal?.throwIfAborted();
    const page = await pdf.getPage(number);
    const text = textFromItems((await page.getTextContent()).items);
    if (hasTextLayer(text)) {
      pages.push({ kind: "text", text });
      continue;
    }
    pictures += 1;
    if (pictures > MAX_EXTRACT_IMAGES) throw new TooManyPagesError(MAX_EXTRACT_IMAGES);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: MAX_SIDE / Math.max(base.width, base.height) });
    // pdf.js draws the page on its own canvas, which is then copied onto white at the size that fits.
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport }).promise;
    pages.push({
      kind: "image",
      image: await encode((context, width, height) => context.drawImage(canvas, 0, 0, width, height), canvas.width, canvas.height),
    });
    page.cleanup();
  }
  return pages;
};

/** A PDF from this server, opened with pdf.js. */
export const preparePdf = async (url: string, signal?: AbortSignal): Promise<PreparedPage[]> => {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ url, enableXfa: false });
  try {
    return await preparePdfDocument(await task.promise, signal);
  } finally {
    void task.destroy();
  }
};
