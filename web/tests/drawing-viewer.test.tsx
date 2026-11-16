import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { create } from "@bufbuild/protobuf";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { insertSceneChunk, type Scene } from "@usememos/canvas";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import DrawingViewer from "@/components/DrawingSheet/DrawingViewer";
import { AttachmentGallery } from "@/components/MemoMetadata/Attachment/AttachmentListView";
import { AttachmentSchema } from "@/types/proto/api/attachment_service_pb";
import { MemoSchema } from "@/types/proto/api/memo_service_pb";
import { User_Role, UserSchema } from "@/types/proto/api/user_service_pb";

const mocks = vi.hoisted(() => ({
  canvasProps: [] as Array<{ readOnly?: boolean; initialScene?: { elements: unknown[] } }>,
  uploadFile: vi.fn(),
  updateMemo: vi.fn(),
  currentUser: undefined as unknown,
  // The memo as the server has it when Save re-reads it.
  getMemo: vi.fn(),
  toast: vi.fn(),
}));

const handle = {
  setTool: vi.fn(),
  setStyle: vi.fn(),
  zoomToFit: vi.fn(),
  getViewport: vi.fn(() => ({ zoom: 1, scrollX: 0, scrollY: 0 })),
  zoomTo: vi.fn(),
  setScene: vi.fn(),
  getScene: vi.fn(() => ({ elements: [], files: {}, appState: {} })),
  canUndo: () => false,
  canRedo: () => false,
  isDirty: () => true,
  markSaved: vi.fn(),
  commitText: vi.fn(),
  insertImage: vi.fn(),
  exportPng: vi.fn(),
  setSelection: vi.fn(),
  focus: vi.fn(),
};

vi.mock("@usememos/canvas/react", () => ({
  Canvas: forwardRef((props: { ariaLabel?: string; readOnly?: boolean; initialScene?: { elements: unknown[] } }, ref) => {
    mocks.canvasProps.push(props);
    useImperativeHandle(ref, () => handle, []);
    return <div role="img" aria-label={props.ariaLabel} />;
  }),
}));
vi.mock("@/components/MemoEditor/edit/services/uploadService", () => ({ uploadService: { uploadFile: mocks.uploadFile } }));
vi.mock("@/hooks/useMemoQueries", () => ({ useUpdateMemo: () => ({ mutateAsync: mocks.updateMemo }) }));
vi.mock("@/connect", () => ({ memoServiceClient: { getMemo: mocks.getMemo } }));
vi.mock("@/lib/toast", () => ({ showErrorToast: mocks.toast }));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => mocks.currentUser }));
vi.mock("@/hooks/useImmichQueries", () => ({ useImmichConnection: () => ({ data: undefined }) }));
vi.mock("@/utils/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/i18n")>()),
  useTranslate: () => (key: string) => key,
}));

const fixturePng = new Uint8Array(readFileSync(resolve(__dirname, "fixtures/canvas/v1.canvas.png")));
const scene = {
  type: "memos-canvas",
  version: 1,
  elements: [
    {
      id: "r1",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 80,
      height: 40,
      angle: 0,
      strokeColor: "#1a1a1a",
      backgroundColor: "transparent",
      strokeWidth: 2,
      opacity: 100,
      roundness: 8,
      isDeleted: false,
      groupIds: [],
      boundElements: [],
      seed: 1,
      locked: false,
    },
  ],
  files: {},
  appState: { viewBackgroundColor: "#fbfaf7", zoom: 1, scrollX: 0, scrollY: 0, handDrawn: false },
} as unknown as Scene;

const author = create(UserSchema, { name: "users/author", role: User_Role.USER });
const drawing = create(AttachmentSchema, {
  name: "attachments/d1",
  creator: author.name,
  filename: "drawing-20261106-101500.canvas.png",
  type: "image/png",
});
const memo = create(MemoSchema, { name: "memos/m1", creator: author.name, attachments: [drawing] });
const withScene = async () => new Uint8Array(await insertSceneChunk(fixturePng, scene));

/** Edit stays disabled until the drawing's scene has loaded. */
const startEditing = async () => {
  const edit = await screen.findByRole("button", { name: "common.edit" });
  await waitFor(() => expect(edit).toBeEnabled());
  fireEvent.click(edit);
};

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }),
  });
});

beforeEach(async () => {
  mocks.canvasProps.length = 0;
  mocks.currentUser = author;
  mocks.getMemo.mockReset().mockResolvedValue(memo);
  mocks.toast.mockReset();
  mocks.uploadFile.mockReset();
  mocks.updateMemo.mockReset();
  handle.insertImage.mockReset().mockResolvedValue("background");
  const bytes = await withScene();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(bytes)),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DrawingViewer", () => {
  it("shows the drawing read-only, with the zoom menu and Edit for the author", async () => {
    render(<DrawingViewer attachment={drawing} memo={memo} canEdit onClose={vi.fn()} onNoScene={vi.fn()} />);

    await waitFor(() => expect(mocks.canvasProps.at(-1)?.initialScene?.elements).toHaveLength(1));
    expect(mocks.canvasProps.at(-1)?.readOnly).toBe(true);
    expect(screen.getByRole("button", { name: "editor.drawing.zoom 100%" })).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "common.edit" })).toBeEnabled();
  });

  it("offers no Edit to someone who cannot change the memo", async () => {
    render(<DrawingViewer attachment={drawing} memo={memo} canEdit={false} onClose={vi.fn()} onNoScene={vi.fn()} />);

    await waitFor(() => expect(mocks.canvasProps.at(-1)?.readOnly).toBe(true));
    expect(screen.queryByRole("button", { name: "common.edit" })).not.toBeInTheDocument();
  });

  it("hands a file without a scene back to the image viewer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(fixturePng.slice(0, 33))),
    );
    const onNoScene = vi.fn();
    render(<DrawingViewer attachment={drawing} memo={memo} canEdit onClose={vi.fn()} onNoScene={onNoScene} />);

    await waitFor(() => expect(onNoScene).toHaveBeenCalled());
  });

  it("Edit replaces the drawing in place and stamps the memo", async () => {
    const edited = await withScene();
    handle.exportPng.mockResolvedValue(new Blob([edited], { type: "image/png" }));
    mocks.uploadFile.mockResolvedValue(drawing);
    render(<DrawingViewer attachment={drawing} memo={memo} canEdit onClose={vi.fn()} onNoScene={vi.fn()} />);

    await startEditing();
    fireEvent.click(await screen.findByRole("button", { name: /^common\.(add|save)$/ }));

    await waitFor(() => expect(mocks.updateMemo).toHaveBeenCalledWith({ update: { name: memo.name }, updateMask: ["update_time"] }));
    expect(mocks.uploadFile.mock.calls[0][0].replaces).toBe(drawing.name);
    // Back in the viewer, read-only again.
    await waitFor(() => expect(screen.getByRole("button", { name: "editor.drawing.zoom 100%" })).toBeInTheDocument());
    expect(mocks.canvasProps.at(-1)?.readOnly).toBe(true);
  });

  it("adds an edit of someone else's drawing beside it, and a retry reuses the uploaded copy", async () => {
    // The memo's author may change the memo but not replace or remove a file someone else uploaded.
    const othersDrawing = create(AttachmentSchema, { ...drawing, creator: "users/other" });
    const copy = create(AttachmentSchema, { name: "attachments/d2", filename: "drawing-2.canvas.png", type: "image/png" });
    handle.exportPng.mockResolvedValue(new Blob([await withScene()], { type: "image/png" }));
    mocks.uploadFile.mockResolvedValue(copy);
    mocks.updateMemo.mockRejectedValueOnce(new Error("offline"));
    const othersMemo = create(MemoSchema, { ...memo, attachments: [othersDrawing] });
    mocks.getMemo.mockResolvedValue(othersMemo);
    render(<DrawingViewer attachment={othersDrawing} memo={othersMemo} canEdit onClose={vi.fn()} onNoScene={vi.fn()} />);

    await startEditing();
    const done = await screen.findByRole("button", { name: /^common\.(add|save)$/ });
    fireEvent.click(done);
    await waitFor(() => expect(mocks.updateMemo).toHaveBeenCalledTimes(1));
    expect(mocks.uploadFile.mock.calls[0][0].replaces).toBeUndefined();
    const [{ update, updateMask }] = mocks.updateMemo.mock.calls[0];
    expect(updateMask).toEqual(["attachments"]);
    // Whole attachments, so the gallery keeps showing them while the update is pending.
    expect(update.attachments.map((item: { name: string; filename: string }) => [item.name, item.filename])).toEqual([
      [othersDrawing.name, othersDrawing.filename],
      [copy.name, copy.filename],
    ]);

    // The memo update failed: the sheet stays open, and Done again replaces the copy it uploaded.
    await waitFor(() => expect(done).toBeEnabled());
    fireEvent.click(done);
    await waitFor(() => expect(mocks.updateMemo).toHaveBeenCalledTimes(2));
    expect(mocks.uploadFile.mock.calls[1][0].replaces).toBe(copy.name);
    await waitFor(() => expect(screen.getByRole("button", { name: "editor.drawing.zoom 100%" })).toBeInTheDocument());
  });
});

describe("DrawingViewer pages", () => {
  const second = create(AttachmentSchema, {
    name: "attachments/d2",
    creator: author.name,
    filename: "drawing-20261106-111500.canvas.png",
    type: "image/png",
  });
  const photo = create(AttachmentSchema, { name: "attachments/photo", creator: author.name, filename: "photo.png", type: "image/png" });
  const twoPages = create(MemoSchema, { ...memo, attachments: [drawing, photo, second] });

  it("shows no page tabs for a memo with one drawing", async () => {
    render(<DrawingViewer attachment={drawing} memo={memo} canEdit onClose={vi.fn()} onNoScene={vi.fn()} />);

    await waitFor(() => expect(mocks.canvasProps.at(-1)?.initialScene?.elements).toHaveLength(1));
    expect(screen.queryByRole("group", { name: "editor.drawing.pages" })).not.toBeInTheDocument();
  });

  it("pages through the memo's drawings, reading each one when it is first shown", async () => {
    mocks.getMemo.mockResolvedValue(twoPages);
    render(<DrawingViewer attachment={second} memo={twoPages} canEdit onClose={vi.fn()} onNoScene={vi.fn()} />);

    // The photo is not a page; the drawing opened is page 2.
    const tabs = await screen.findAllByRole("button", { name: "editor.drawing.page" });
    expect(tabs).toHaveLength(2);
    expect(tabs[1]).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    fireEvent.click(tabs[0]);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(vi.mocked(fetch).mock.calls[1][0]).toContain(drawing.name.split("/")[1]);
    await waitFor(() => expect(tabs[0]).toHaveAttribute("aria-pressed", "true"));
    // The tab turns pressed before the new page's canvas has rendered, so wait for the canvas too.
    await waitFor(() => expect(mocks.canvasProps.at(-1)?.readOnly).toBe(true));
  });

  it("adds a page from Edit as a new drawing right after the page before it", async () => {
    const added = create(AttachmentSchema, {
      name: "attachments/d3",
      creator: author.name,
      filename: "drawing-3.canvas.png",
      type: "image/png",
    });
    handle.exportPng.mockResolvedValue(new Blob([await withScene()], { type: "image/png" }));
    mocks.uploadFile.mockReset();
    mocks.uploadFile.mockImplementation(async ({ replaces }: { replaces?: string }) =>
      replaces === drawing.name ? drawing : replaces === second.name ? second : added,
    );
    mocks.updateMemo.mockReset();
    mocks.updateMemo.mockResolvedValue(undefined);
    mocks.getMemo.mockResolvedValue(twoPages);
    render(<DrawingViewer attachment={drawing} memo={twoPages} canEdit onClose={vi.fn()} onNoScene={vi.fn()} />);

    await startEditing();
    fireEvent.click(await screen.findByRole("button", { name: "editor.drawing.add-page" }));
    fireEvent.click(screen.getByRole("button", { name: /^common\.(add|save)$/ }));

    await waitFor(() => expect(mocks.updateMemo).toHaveBeenCalledTimes(1));
    // Page 1 (shown, and dirty in this mock) is replaced in place; the new page uploads as its own file.
    expect(mocks.uploadFile.mock.calls.map(([file]) => file.replaces)).toEqual([drawing.name, undefined]);
    const [{ update, updateMask }] = mocks.updateMemo.mock.calls[0];
    expect(updateMask).toEqual(["attachments"]);
    expect(update.attachments.map((item: { name: string }) => item.name)).toEqual([drawing.name, added.name, photo.name, second.name]);
  });
});

describe("drawings in a memo's gallery", () => {
  it("open in the drawing viewer, not the image viewer", async () => {
    const onImagePreview = vi.fn();
    render(<AttachmentGallery visual={[drawing]} onImagePreview={onImagePreview} drawings={{ memo, canEdit: false }} />);

    fireEvent.click(screen.getByRole("button", { name: drawing.filename }));

    expect(await screen.findByRole("dialog", { name: "editor.insert-menu.drawing" })).toBeInTheDocument();
    expect(onImagePreview).not.toHaveBeenCalled();
  });
});

describe("DrawingViewer safeguards and markup", () => {
  const photo = create(AttachmentSchema, { name: "attachments/p1", creator: author.name, filename: "photo.png", type: "image/png" });
  const after = create(AttachmentSchema, { name: "attachments/z9", creator: author.name, filename: "notes.pdf", type: "application/pdf" });
  const photoMemo = create(MemoSchema, { name: "memos/m1", creator: author.name, attachments: [photo, after] });

  it("opens an image to mark up in the sheet at once, and Save copy adds the markup right after it", async () => {
    // The image holds no scene: it becomes the locked background of a new drawing.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(fixturePng.slice(0, 33))),
    );
    const copy = create(AttachmentSchema, { name: "attachments/m2", filename: "drawing-2.canvas.png", type: "image/png" });
    handle.exportPng.mockResolvedValue(new Blob([await withScene()], { type: "image/png" }));
    mocks.uploadFile.mockResolvedValue(copy);
    mocks.getMemo.mockResolvedValue(photoMemo);
    const onClose = vi.fn();
    const onNoScene = vi.fn();
    render(<DrawingViewer attachment={photo} memo={photoMemo} canEdit annotate onClose={onClose} onNoScene={onNoScene} />);

    const save = await screen.findByRole("button", { name: "editor.drawing.save-copy" });
    expect(onNoScene).not.toHaveBeenCalled();
    await waitFor(() => expect(handle.insertImage).toHaveBeenCalledWith(expect.anything(), { background: true }));
    // Red ink shows on a photo; the memo's drawings are not pages of this sheet.
    expect(handle.setStyle).toHaveBeenCalledWith(expect.objectContaining({ strokeColor: "#e03131" }));
    expect(screen.queryByRole("button", { name: "editor.drawing.page 2" })).not.toBeInTheDocument();
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);

    await waitFor(() => expect(mocks.updateMemo).toHaveBeenCalled());
    // A new file, never over the photo; the photo keeps its place and the markup follows it.
    expect(mocks.uploadFile.mock.calls[0][0].replaces).toBeUndefined();
    const update = mocks.updateMemo.mock.calls[0][0];
    expect(update.updateMask).toEqual(["attachments"]);
    expect(update.update.attachments.map((item: { name: string }) => item.name)).toEqual([photo.name, copy.name, after.name]);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("stops when the image being marked up has left the memo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(fixturePng.slice(0, 33))),
    );
    handle.exportPng.mockResolvedValue(new Blob([await withScene()], { type: "image/png" }));
    mocks.getMemo.mockResolvedValue(create(MemoSchema, { ...photoMemo, attachments: [after] }));
    render(<DrawingViewer attachment={photo} memo={photoMemo} canEdit annotate onClose={vi.fn()} onNoScene={vi.fn()} />);

    const save = await screen.findByRole("button", { name: "editor.drawing.save-copy" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("editor.drawing.unavailable"));
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(mocks.updateMemo).not.toHaveBeenCalled();
  });

  it("never overwrites a drawing that changed elsewhere: it offers Save copy instead", async () => {
    const copy = create(AttachmentSchema, { name: "attachments/d2", filename: "drawing-2.canvas.png", type: "image/png" });
    handle.exportPng.mockResolvedValue(new Blob([await withScene()], { type: "image/png" }));
    mocks.uploadFile.mockResolvedValue(copy);
    render(<DrawingViewer attachment={drawing} memo={memo} canEdit onClose={vi.fn()} onNoScene={vi.fn()} />);
    await startEditing();

    // Another tab saved the drawing after this one read it.
    const elsewhere = { ...scene, elements: [{ ...scene.elements[0], width: 200 }] } as unknown as Scene;
    const changed = new Uint8Array(await insertSceneChunk(fixturePng, elsewhere));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(changed)),
    );
    fireEvent.click(await screen.findByRole("button", { name: "common.save" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("editor.drawing.changed-save-copy"));
    expect(mocks.uploadFile).not.toHaveBeenCalled();

    // The same edit, saved beside the drawing.
    fireEvent.click(await screen.findByRole("button", { name: "editor.drawing.save-copy" }));
    await waitFor(() => expect(mocks.updateMemo).toHaveBeenCalled());
    expect(mocks.uploadFile.mock.calls[0][0].replaces).toBeUndefined();
    const update = mocks.updateMemo.mock.calls[0][0];
    expect(update.update.attachments.map((item: { name: string }) => item.name)).toEqual([drawing.name, copy.name]);
  });

  it("says the drawing is saved when only the memo update failed", async () => {
    handle.exportPng.mockResolvedValue(new Blob([await withScene()], { type: "image/png" }));
    mocks.uploadFile.mockResolvedValue(drawing);
    mocks.updateMemo.mockRejectedValueOnce(new Error("offline"));
    render(<DrawingViewer attachment={drawing} memo={memo} canEdit onClose={vi.fn()} onNoScene={vi.fn()} />);
    await startEditing();
    fireEvent.click(await screen.findByRole("button", { name: "common.save" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("editor.drawing.saved-needs-update"));
    // Still in the sheet, to retry.
    expect(screen.getByRole("button", { name: "common.save" })).toBeInTheDocument();
  });
});
