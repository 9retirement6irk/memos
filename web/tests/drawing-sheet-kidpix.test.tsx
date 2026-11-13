import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef, type Ref, useImperativeHandle } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import DrawingSheet from "@/components/DrawingSheet/DrawingSheet";
import type { KidPixHandle, KidPixLayerProps } from "@/components/DrawingSheet/kidpix/KidPixLayer";

const calls: string[] = [];
let viewport = { zoom: 2, scrollX: 30, scrollY: -10 };
let nextId = 0;
const handle = {
  setTool: vi.fn(),
  setStyle: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  canUndo: vi.fn(() => false),
  canRedo: vi.fn(() => false),
  zoomToFit: vi.fn(),
  zoomTo: vi.fn((zoom: number) => {
    viewport = { ...viewport, zoom };
  }),
  getViewport: vi.fn(() => viewport),
  setSelection: vi.fn((ids: string[]) => calls.push(`select ${ids.join(",")}`)),
  groupSelection: vi.fn(() => calls.push("group")),
  insertImage: vi.fn(async (_blob: Blob, options?: { at?: [number, number] }) => {
    calls.push(`insert ${options?.at?.join(",")}`);
    return `image${++nextId}`;
  }),
  markSaved: vi.fn(),
  isDirty: vi.fn(() => false),
  commitText: vi.fn(),
  exportPng: vi.fn(async () => {
    calls.push("exportPng");
    return new Blob(["png"], { type: "image/png" });
  }),
};

vi.mock("@usememos/canvas/react", () => ({
  Canvas: forwardRef((props: { ariaLabel?: string }, ref) => {
    useImperativeHandle(ref, () => handle, []);
    return <div role="img" aria-label={props.ariaLabel} tabIndex={0} />;
  }),
}));

// The layer itself needs a real canvas; the sheet only needs its handle and its props.
let layerProps: KidPixLayerProps | null = null;
let tiles: Awaited<ReturnType<KidPixHandle["takeTiles"]>> = [];
const takeTiles = vi.fn(async (_maxSide: number) => tiles);
const addPictures = vi.fn(async (_files: readonly File[]) => 0);
vi.mock("@/components/DrawingSheet/kidpix/KidPixLayer", () => ({
  default: (props: KidPixLayerProps & { ref?: Ref<KidPixHandle> }) => {
    layerProps = props;
    useImperativeHandle(props.ref, () => ({ hasPaint: () => tiles.length > 0, takeTiles, addPictures }), []);
    return <div data-testid="kidpix-layer" />;
  },
}));

vi.mock("@/hooks/useImmichQueries", () => ({ useImmichConnection: () => ({ data: undefined }) }));
vi.mock("@/utils/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/i18n")>()),
  useTranslate: () => (key: string) => key,
}));

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }),
  });
  // jsdom lays nothing out; give the drawing surface a size.
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1000 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 800 });
});

beforeEach(() => {
  calls.length = 0;
  nextId = 0;
  layerProps = null;
  tiles = [];
  viewport = { zoom: 2, scrollX: 30, scrollY: -10 };
  takeTiles.mockClear();
  handle.isDirty.mockReturnValue(false);
});

const tile = (x: number, y: number, width: number, height: number) => ({
  x,
  y,
  width,
  height,
  blob: new Blob(["tile"], { type: "image/png" }),
});

const enterKidPix = async () => {
  fireEvent.click(screen.getByRole("button", { name: "editor.drawing.kidpix" }));
  await screen.findByTestId("kidpix-layer");
};

describe("DrawingSheet in Kid Pix mode", () => {
  it("opens the paint layer over the view as it is, with the memos tools put away", async () => {
    render(<DrawingSheet mode="new" pages={[{ key: "p1" }]} initialPage="p1" onDone={vi.fn()} onClose={vi.fn()} />);
    await enterKidPix();

    expect(layerProps?.view).toEqual({ zoom: 2, scrollX: 30, scrollY: -10, width: 1000, height: 800 });
    expect(layerProps?.compact).toBe(false);
    expect(handle.setSelection).toHaveBeenCalledWith([]);
    expect(screen.queryByRole("button", { name: "editor.drawing.tool-pen" })).toBeNull();
    // Cancel and Done stay, clear of the tube; Cancel on a bar of its own.
    expect(screen.getByRole("button", { name: "common.cancel" }).closest(".left-\\[148px\\]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "editor.drawing.done" })).toBeInTheDocument();
  });

  it("puts a picture chosen in the mode on the paint layer, not on the drawing under it", async () => {
    const { container } = render(<DrawingSheet mode="new" pages={[{ key: "p1" }]} initialPage="p1" onDone={vi.fn()} onClose={vi.fn()} />);
    await enterKidPix();
    expect(screen.getByRole("button", { name: "editor.insert-menu.insert-image" })).toBeInTheDocument();

    const photo = new File(["photo"], "photo.png", { type: "image/png" });
    const notes = new File(["notes"], "notes.txt", { type: "text/plain" });
    fireEvent.change(container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [photo, notes] },
    });

    await waitFor(() => expect(addPictures).toHaveBeenCalledWith([photo]));
    expect(handle.insertImage).not.toHaveBeenCalled();
  });

  it("zooms in to 1 first when the view is zoomed out, so a layer pixel is a drawing px", async () => {
    viewport = { zoom: 0.5, scrollX: 0, scrollY: 0 };
    render(<DrawingSheet mode="new" pages={[{ key: "p1" }]} initialPage="p1" onDone={vi.fn()} onClose={vi.fn()} />);
    await enterKidPix();

    expect(handle.zoomTo).toHaveBeenCalledWith(1);
    expect(layerProps?.view.zoom).toBe(1);
  });

  it("adds the paint to the drawing where it was painted, as one group, on the way out", async () => {
    render(<DrawingSheet mode="new" pages={[{ key: "p1" }]} initialPage="p1" onDone={vi.fn()} onClose={vi.fn()} />);
    await enterKidPix();
    tiles = [tile(100, 40, 200, 100), tile(300, 40, 200, 100)];

    fireEvent.click(screen.getByRole("button", { name: "editor.drawing.kidpix-exit" }));

    await waitFor(() => expect(screen.queryByTestId("kidpix-layer")).toBeNull());
    // Tiles no larger than 80% of the view in drawing px: 0.8 x 800 / 2.
    expect(takeTiles).toHaveBeenCalledWith(320);
    // Each tile goes in by its center, moved from layer px to drawing px by the view's scroll.
    expect(calls).toEqual(["select ", "insert 170,100", "insert 370,100", "select image1,image2", "group"]);
    expect(screen.getByRole("button", { name: "editor.drawing.tool-pen" })).toBeInTheDocument();
  });

  it("leaves nothing behind when nothing was painted", async () => {
    render(<DrawingSheet mode="new" pages={[{ key: "p1" }]} initialPage="p1" onDone={vi.fn()} onClose={vi.fn()} />);
    await enterKidPix();

    fireEvent.click(screen.getByRole("button", { name: "editor.drawing.kidpix-exit" }));

    await waitFor(() => expect(screen.queryByTestId("kidpix-layer")).toBeNull());
    expect(handle.insertImage).not.toHaveBeenCalled();
    expect(handle.groupSelection).not.toHaveBeenCalled();
  });

  it("puts paint still on the layer into the drawing before Done exports it", async () => {
    // The paint makes the page a change to export.
    handle.isDirty.mockReturnValue(true);
    const onDone = vi.fn();
    render(<DrawingSheet mode="new" pages={[{ key: "p1" }]} initialPage="p1" onDone={onDone} onClose={vi.fn()} />);
    await enterKidPix();
    tiles = [tile(0, 0, 50, 50)];

    fireEvent.click(screen.getByRole("button", { name: "editor.drawing.done" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(calls).toEqual(["select ", "insert -5,35", "exportPng"]);
  });

  it("asks before discarding paint that is not in the drawing yet", async () => {
    const onClose = vi.fn();
    render(<DrawingSheet mode="new" pages={[{ key: "p1" }]} initialPage="p1" onDone={vi.fn()} onClose={onClose} />);
    await enterKidPix();
    tiles = [tile(0, 0, 50, 50)];

    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByText("editor.drawing.discard-title")).toBeInTheDocument();
  });

  it("mutes the layer from the sounds toggle", async () => {
    render(<DrawingSheet mode="new" pages={[{ key: "p1" }]} initialPage="p1" onDone={vi.fn()} onClose={vi.fn()} />);
    await enterKidPix();
    expect(layerProps?.muted).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "editor.drawing.kidpix-sounds" }));

    await waitFor(() => expect(layerProps?.muted).toBe(true));
  });
});
