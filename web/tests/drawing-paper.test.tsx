import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle, useState } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import DrawingSheet from "@/components/DrawingSheet/DrawingSheet";
import { findPaperElement, PAPER_SIZE } from "@/components/DrawingSheet/paper/papers";

interface Element {
  id: string;
  type: string;
  locked: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
}

/** A canvas that keeps a scene, so inserting, finding and deleting the paper can be checked. */
const makeHandle = (label: string) => {
  let count = 0;
  const handle = {
    label,
    elements: [] as Element[],
    selection: [] as string[],
    setTool: vi.fn(),
    setStyle: vi.fn(),
    canUndo: vi.fn(() => false),
    canRedo: vi.fn(() => false),
    zoomToFit: vi.fn(),
    focus: vi.fn(),
    markSaved: vi.fn(),
    commitText: vi.fn(),
    isDirty: vi.fn(() => false),
    isEmpty: vi.fn(() => handle.elements.length === 0),
    getScene: vi.fn(() => ({ elements: handle.elements })),
    setSelection: vi.fn((ids: string[]) => {
      handle.selection = ids;
    }),
    setLocked: vi.fn((ids: string[], locked: boolean) => {
      for (const element of handle.elements) if (ids.includes(element.id)) element.locked = locked;
      return ids.length;
    }),
    deleteSelection: vi.fn(() => {
      // Locked elements can't be deleted.
      handle.elements = handle.elements.filter((element) => !handle.selection.includes(element.id) || element.locked);
    }),
    insertImage: vi.fn(async (_blob: Blob, options?: { background?: boolean }) => {
      const id = `image${++count}`;
      const element = { id, type: "image", locked: Boolean(options?.background), x: 0, y: 0, ...PAPER_SIZE };
      handle.elements = options?.background ? [element, ...handle.elements] : [...handle.elements, element];
      return id;
    }),
    exportPng: vi.fn(async () => new Blob([label], { type: "image/png" })),
  };
  return handle;
};
type Handle = ReturnType<typeof makeHandle>;
const handles: Handle[] = [];
const lastHandle = () => handles[handles.length - 1];

vi.mock("@usememos/canvas/react", () => ({
  Canvas: forwardRef((props: { ariaLabel?: string }, ref) => {
    const [handle] = useState(() => {
      const created = makeHandle(props.ariaLabel ?? "");
      handles.push(created);
      return created;
    });
    useImperativeHandle(ref, () => handle, [handle]);
    return <div role="img" aria-label={props.ariaLabel} />;
  }),
}));

vi.mock("@/hooks/useImmichQueries", () => ({ useImmichConnection: () => ({ data: undefined }) }));

vi.mock("@/utils/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/i18n")>()),
  useTranslate: () => (key: string, options?: { number?: number }) => (options?.number ? `${key} ${options.number}` : key),
}));

// A string body: a Response built from a jsdom Blob cannot be read back.
const fetchMock = vi.fn(async (url: string) => new Response(url, { headers: { "Content-Type": "image/png" } }));

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }),
  });
});

beforeEach(() => {
  handles.length = 0;
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

const choose = async (paper: string) => {
  fireEvent.click(screen.getByRole("button", { name: "editor.drawing.paper" }));
  await act(async () => fireEvent.click(await screen.findByRole("button", { name: `editor.drawing.paper-${paper}` })));
};

describe("findPaperElement", () => {
  const scene = (elements: Partial<Element>[]) => ({ getScene: () => ({ elements }) }) as never;
  const paper = { id: "p", type: "image", locked: true, x: 0, y: 0, ...PAPER_SIZE };

  it("finds the paper at the bottom of a drawing", () => {
    expect(findPaperElement(scene([paper, { id: "s", type: "freedraw", x: 3, y: 4 }]))).toBe("p");
    expect(findPaperElement(scene([{ ...paper, id: "gone", isDeleted: true }, paper]))).toBe("p");
  });

  it("leaves a picture the drawing was started over, and anything not at the bottom", () => {
    expect(findPaperElement(scene([{ ...paper, width: 1280, height: 960 }]))).toBeUndefined();
    expect(findPaperElement(scene([{ ...paper, locked: false }]))).toBeUndefined();
    expect(findPaperElement(scene([{ id: "s", type: "freedraw", x: 0, y: 0 }, paper]))).toBeUndefined();
    expect(findPaperElement(scene([]))).toBeUndefined();
  });
});

describe("DrawingSheet paper", () => {
  it("puts a paper under the drawing, swaps it for another, and takes it away", async () => {
    render(<DrawingSheet mode="new" pages={[{ key: "a" }]} initialPage="a" onDone={vi.fn()} onClose={vi.fn()} />);
    const canvas = lastHandle();

    await choose("college-ruled");
    expect(canvas.insertImage).toHaveBeenCalledWith(expect.anything(), { background: true });
    expect(fetchMock.mock.calls[0][0]).toContain("college-ruled");
    expect(canvas.elements.map((element) => element.id)).toEqual(["image1"]);
    // A blank page is fitted to its new paper.
    expect(canvas.zoomToFit).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "editor.drawing.paper" })).toBeEnabled();

    await choose("graph");
    expect(canvas.setLocked).toHaveBeenCalledWith(["image1"], false);
    expect(canvas.deleteSelection).toHaveBeenCalled();
    expect(canvas.elements.map((element) => element.id)).toEqual(["image2"]);
    // Picking the old paper switched to the select tool; the pen comes back.
    expect(canvas.setTool).toHaveBeenLastCalledWith("pen");

    await choose("plain");
    expect(canvas.elements).toEqual([]);
  });

  it("keeps a picture the drawing was started over when a paper goes under it", async () => {
    render(<DrawingSheet mode="new" pages={[{ key: "a" }]} initialPage="a" onDone={vi.fn()} onClose={vi.fn()} />);
    const canvas = lastHandle();
    canvas.elements = [{ id: "photo", type: "image", locked: true, x: 0, y: 0, width: 1280, height: 960 }];

    await choose("dot-grid");
    expect(canvas.deleteSelection).not.toHaveBeenCalled();
    expect(canvas.elements.map((element) => element.id)).toEqual(["image1", "photo"]);
  });

  it("starts an added page on the same paper, as where the drawing starts, not a change", async () => {
    render(<DrawingSheet mode="new" pages={[{ key: "a" }]} initialPage="a" onDone={vi.fn()} onClose={vi.fn()} />);
    await choose("wide-ruled");

    fireEvent.click(screen.getByRole("button", { name: "editor.drawing.add-page" }));
    await waitFor(() => expect(handles).toHaveLength(2));
    const added = lastHandle();
    await waitFor(() => expect(added.insertImage).toHaveBeenCalledWith(expect.anything(), { background: true }));
    await waitFor(() => expect(added.markSaved).toHaveBeenCalled());
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes("wide-ruled"))).toBe(true);
  });
});
