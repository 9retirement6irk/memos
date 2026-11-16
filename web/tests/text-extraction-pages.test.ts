import type { PDFDocumentProxy } from "pdfjs-dist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_EXTRACT_IMAGE_BYTES, MAX_EXTRACT_IMAGES } from "@/lib/textExtraction";
import {
  assembleText,
  fitScale,
  hasTextLayer,
  MAX_SIDE,
  type PreparedPage,
  picturesOf,
  preparePdfDocument,
  TooManyPagesError,
  textFromItems,
} from "@/lib/textExtractionPages";

const picture = (data: string): PreparedPage => ({ kind: "image", image: { mediaType: "image/jpeg", data } });
const text = (value: string): PreparedPage => ({ kind: "text", text: value });

describe("textFromItems", () => {
  it("joins pdf.js text items with their line breaks and skips marked content", () => {
    const items = [
      { str: "Dear ", hasEOL: false },
      { type: "beginMarkedContent" },
      { str: "Will,  ", hasEOL: true },
      { str: "Thanks", hasEOL: true },
    ];
    expect(textFromItems(items)).toBe("Dear Will,\nThanks");
  });

  it("calls a page with a few stray letters a scan", () => {
    expect(hasTextLayer("  p. 3 \n")).toBe(false);
    expect(hasTextLayer("Minutes of the meeting held on Monday")).toBe(true);
  });
});

describe("assembleText", () => {
  const pages = [text("Page one has its own text."), picture("a"), text("Page three too."), picture("b")];

  it("puts each picture's text in its page's place", () => {
    expect(assembleText(pages, { text: "unused", pages: ["Scan two", ""] })).toBe(
      "Page one has its own text.\n\nScan two\n\nPage three too.",
    );
  });

  it("puts the whole answer where the first picture was when it couldn't be split", () => {
    expect(assembleText(pages, { text: "Both scans", pages: [] })).toBe("Page one has its own text.\n\nBoth scans\n\nPage three too.");
  });

  it("reads a PDF with text on every page without an answer", () => {
    expect(assembleText([text("One"), text("Two")])).toBe("One\n\nTwo");
    expect(picturesOf(pages).map((image) => image.data)).toEqual(["a", "b"]);
  });
});

describe("fitScale", () => {
  it("scales the longest side down to the limit and never enlarges", () => {
    expect(fitScale(4000, 3000)).toBe(MAX_SIDE / 4000);
    expect(fitScale(800, 600)).toBe(1);
  });
});

describe("preparePdfDocument", () => {
  const blobSizes: number[] = [];
  const qualities: (number | undefined)[] = [];

  beforeEach(() => {
    blobSizes.length = 0;
    qualities.length = 0;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (callback, _type, quality) {
      qualities.push(quality as number | undefined);
      callback(new Blob([new Uint8Array(blobSizes.shift() ?? 10)], { type: "image/jpeg" }));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const fakePdf = (pageTexts: string[]) => {
    const render = vi.fn(() => ({ promise: Promise.resolve() }));
    const pdf = {
      numPages: pageTexts.length,
      getPage: async (number: number) => ({
        getTextContent: async () => ({ items: [{ str: pageTexts[number - 1], hasEOL: false }] }),
        getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
        render,
        cleanup: vi.fn(),
      }),
    } as unknown as PDFDocumentProxy;
    return { pdf, render };
  };

  it("reads pages with their own text here and renders only the scanned ones", async () => {
    const { pdf, render } = fakePdf(["A page with plenty of its own text", "", "Another page with its own text"]);
    const pages = await preparePdfDocument(pdf);
    expect(pages.map((page) => page.kind)).toEqual(["text", "image", "text"]);
    expect(render).toHaveBeenCalledTimes(1);
    const { viewport } = (render.mock.calls[0] as unknown as [{ viewport: { width: number; height: number } }])[0];
    expect(Math.max(viewport.width, viewport.height)).toBeCloseTo(MAX_SIDE);
    expect(pages[1]).toMatchObject({ kind: "image", image: { mediaType: "image/jpeg" } });
  });

  it("lowers the quality until a picture fits", async () => {
    blobSizes.push(MAX_EXTRACT_IMAGE_BYTES + 1, 1000);
    const { pdf } = fakePdf([""]);
    await preparePdfDocument(pdf);
    expect(qualities).toEqual([0.9, 0.75]);
  });

  it("refuses more scanned pages than one request can carry", async () => {
    const { pdf } = fakePdf(Array.from({ length: MAX_EXTRACT_IMAGES + 1 }, () => ""));
    await expect(preparePdfDocument(pdf)).rejects.toEqual(new TooManyPagesError(MAX_EXTRACT_IMAGES));
  });
});
