import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  heicTo: vi.fn(),
  extractMetadata: vi.fn(),
  dispatch: vi.fn(),
  toastAdd: vi.fn(() => "toast-1"),
  toastClose: vi.fn(),
  errorToast: vi.fn(),
}));

vi.mock("heic-to/csp", () => ({ heicTo: mocks.heicTo }));
// useFileUpload's module graph reaches AuthContext and the query hooks; stub every client they name-import.
vi.mock("@/connect", () => ({ attachmentServiceClient: {}, authServiceClient: {}, userServiceClient: {}, refreshAccessToken: vi.fn() }));
vi.mock("@/components/MemoEditor/edit/services/mediaMetadataService", () => ({
  mediaMetadataService: { extract: mocks.extractMetadata },
}));
vi.mock("@/lib/toast", () => ({ toast: { add: mocks.toastAdd, close: mocks.toastClose }, showErrorToast: mocks.errorToast }));
vi.mock("@/components/MemoEditor/edit/state", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/MemoEditor/edit/state")>();
  return { ...original, useEditorContext: () => ({ actions: original.editorActions, dispatch: mocks.dispatch }) };
});
vi.mock("@/utils/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/i18n")>()),
  useTranslate: () => (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
}));

import { toLocalFiles } from "@/components/MemoEditor/edit/hooks/useFileUpload";
import { useHeicConversion } from "@/components/MemoEditor/edit/hooks/useHeicConversion";
import { validationService } from "@/components/MemoEditor/edit/services/validationService";
import { createInitialState } from "@/components/MemoEditor/edit/state";
import { convertHeicToJpeg, decodeImage, heicOriginal, isHeicFile, jpegFilename } from "@/lib/heic";

const heic = (name = "IMG_0042.HEIC", type = "image/heic") => new File(["heic-bytes"], name, { type, lastModified: 1_700_000_000_000 });
const jpeg = new Blob(["jpeg-bytes"], { type: "image/jpeg" });

/** A browser that can't decode HEIC itself, as Chrome and Firefox can't. */
const withoutNativeHeic = () =>
  vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new DOMException("unsupported", "InvalidStateError")));

describe("HEIC files", () => {
  it("are recognised by type, or by name when the browser gave no type", () => {
    expect(isHeicFile(heic())).toBe(true);
    expect(isHeicFile(heic("a.heif", "image/heif"))).toBe(true);
    expect(isHeicFile(heic("IMG_1.HEIC", ""))).toBe(true);
    expect(isHeicFile(heic("IMG_1.heic", "application/octet-stream"))).toBe(true);
    expect(isHeicFile(new File(["x"], "photo.heic", { type: "image/jpeg" }))).toBe(false);
    expect(isHeicFile(new File(["x"], "photo.jpg", { type: "image/jpeg" }))).toBe(false);
  });

  it("keep their name stem as JPEGs, so a Live Photo still pairs with its video", () => {
    expect(jpegFilename("IMG_0042.HEIC")).toBe("IMG_0042.jpg");
    expect(jpegFilename("scan.heif")).toBe("scan.jpg");
    expect(jpegFilename("photo")).toBe("photo.jpg");
  });
});

describe("convertHeicToJpeg", () => {
  beforeEach(() => {
    mocks.heicTo.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses libheif where the browser can't decode HEIC, and remembers the original", async () => {
    withoutNativeHeic();
    mocks.heicTo.mockResolvedValue(jpeg);
    const original = heic();
    const converted = await convertHeicToJpeg(original);
    expect(mocks.heicTo).toHaveBeenCalledWith({ blob: original, type: "image/jpeg", quality: 0.92 });
    expect(converted.name).toBe("IMG_0042.jpg");
    expect(converted.type).toBe("image/jpeg");
    expect(converted.lastModified).toBe(original.lastModified);
    expect(heicOriginal(converted)).toBe(original);
  });

  it("uses Safari's own decoder when it has one, without loading libheif", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 40, height: 30, close: vi.fn() }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(jpeg));
    const converted = await convertHeicToJpeg(heic());
    expect(converted.type).toBe("image/jpeg");
    expect(mocks.heicTo).not.toHaveBeenCalled();
  });

  it("decodes a stored HEIC for drawing with libheif, but leaves other failures alone", async () => {
    withoutNativeHeic();
    const bitmap = { width: 1, height: 1 };
    mocks.heicTo.mockResolvedValue(bitmap);
    await expect(decodeImage(new Blob(["x"], { type: "image/heic" }))).resolves.toBe(bitmap);
    expect(mocks.heicTo).toHaveBeenCalledWith({ blob: expect.any(Blob), type: "bitmap" });
    await expect(decodeImage(new Blob(["x"], { type: "image/png" }))).rejects.toThrow("unsupported");
  });
});

describe("useHeicConversion", () => {
  beforeEach(() => {
    for (const mock of [mocks.heicTo, mocks.dispatch, mocks.toastAdd, mocks.toastClose, mocks.errorToast]) mock.mockClear();
    mocks.heicTo.mockReset();
    withoutNativeHeic();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const loadingChanges = () =>
    mocks.dispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action.type === "SET_LOADING")
      .map((action) => action.payload);

  it("leaves files without HEIC alone and holds nothing", async () => {
    const { result } = renderHook(() => useHeicConversion());
    const files = [new File(["x"], "a.png", { type: "image/png" })];
    await expect(result.current(files)).resolves.toBe(files);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("converts HEIC photos in place, holding Save and showing progress meanwhile", async () => {
    mocks.heicTo.mockResolvedValue(jpeg);
    const { result } = renderHook(() => useHeicConversion());
    const video = new File(["mov"], "IMG_0042.MOV", { type: "video/quicktime" });
    let converted: File[] = [];
    await act(async () => {
      converted = await result.current([heic(), video]);
    });
    expect(converted.map((file) => file.name)).toEqual(["IMG_0042.jpg", "IMG_0042.MOV"]);
    expect(loadingChanges()).toEqual([
      { key: "converting", value: true },
      { key: "converting", value: false },
    ]);
    expect(mocks.toastAdd).toHaveBeenCalledWith({ title: 'editor.heic.converting {"count":1}', timeout: 0 });
    expect(mocks.toastClose).toHaveBeenCalledWith("toast-1");
    expect(mocks.errorToast).not.toHaveBeenCalled();
  });

  it("keeps a photo it can't convert as it is, and says so", async () => {
    mocks.heicTo.mockRejectedValue(new Error("corrupt"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { result } = renderHook(() => useHeicConversion());
    const original = heic();
    let converted: File[] = [];
    await act(async () => {
      converted = await result.current([original]);
    });
    expect(converted).toEqual([original]);
    expect(mocks.errorToast).toHaveBeenCalledWith('editor.heic.failed {"count":1}');
    expect(loadingChanges().at(-1)).toEqual({ key: "converting", value: false });
  });
});

describe("a converted photo in the editor", () => {
  it("keeps the original's details: date, place, camera and size", async () => {
    withoutNativeHeic();
    mocks.heicTo.mockResolvedValue(jpeg);
    mocks.extractMetadata.mockResolvedValue(undefined);
    const original = heic();
    const converted = await convertHeicToJpeg(original);
    toLocalFiles([converted], { createBlobUrl: () => "blob:x", saveMediaMetadata: true });
    expect(mocks.extractMetadata).toHaveBeenCalledWith(original);
    vi.unstubAllGlobals();
  });

  it("can't be saved until conversion finishes", () => {
    const state = createInitialState();
    state.content = "memo";
    state.ui.isLoading.converting = true;
    expect(validationService.canSave(state)).toEqual({ valid: false, reason: "editor.validation.wait-for-conversion" });
  });
});
