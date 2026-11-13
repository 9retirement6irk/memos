import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle, useState } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import DrawingSheet from "@/components/DrawingSheet/DrawingSheet";
import { isNewPageKey, newPageKey, placeNewPages } from "@/components/DrawingSheet/pages";

/** One handle per mounted canvas, named by its aria-label, so each page can be driven and checked on its own. */
const makeHandle = (label: string) => ({
  label,
  dirty: false,
  setTool: vi.fn(),
  setStyle: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  canUndo: vi.fn(() => false),
  canRedo: vi.fn(() => false),
  zoomToFit: vi.fn(),
  focus: vi.fn(),
  setSelection: vi.fn(),
  insertImage: vi.fn(async () => "image1"),
  markSaved: vi.fn(),
  isDirty: vi.fn(function (this: { dirty: boolean }) {
    return this.dirty;
  }),
  commitText: vi.fn(),
  exportPng: vi.fn(async () => new Blob([label], { type: "image/png" })),
});
type Handle = ReturnType<typeof makeHandle>;
const handles: Handle[] = [];
const handleFor = (label: string) => {
  const found = handles.find((item) => item.label === label);
  if (!found) throw new Error(`No canvas for ${label}`);
  return found;
};

vi.mock("@usememos/canvas/react", () => ({
  Canvas: forwardRef((props: { ariaLabel?: string; initialScene?: unknown }, ref) => {
    const [handle] = useState(() => {
      const created = makeHandle(props.ariaLabel ?? "");
      handles.push(created);
      return created;
    });
    useImperativeHandle(ref, () => handle, [handle]);
    return <div role="img" aria-label={props.ariaLabel} data-scene={props.initialScene ? "yes" : "no"} />;
  }),
}));

vi.mock("@/utils/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/i18n")>()),
  useTranslate: () => (key: string, options?: { number?: number }) => (options?.number ? `${key} ${options.number}` : key),
}));

const scene = { type: "memos-canvas", version: 1, elements: [], files: {}, appState: {} } as never;
const pageLabel = (number: number) => `editor.drawing.edit, editor.drawing.page ${number}`;

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }),
  });
});

beforeEach(() => {
  handles.length = 0;
});

describe("placeNewPages", () => {
  const isNew = (key: string) => key.startsWith("new");

  it("puts a new page right after the page before it, keeping everything else in place", () => {
    expect(placeNewPages(["a", "photo", "b", "pdf"], ["a", "new1", "b"], isNew)).toEqual(["a", "new1", "photo", "b", "pdf"]);
    expect(placeNewPages(["a", "photo", "b"], ["a", "b", "new1", "new2"], isNew)).toEqual(["a", "photo", "b", "new1", "new2"]);
  });

  it("puts a new first page before the page after it, and new pages alone at the end", () => {
    expect(placeNewPages(["photo", "a"], ["new1", "a"], isNew)).toEqual(["photo", "new1", "a"]);
    expect(placeNewPages(["photo"], ["new1", "new2"], isNew)).toEqual(["photo", "new1", "new2"]);
  });

  it("gives added pages keys no attachment has", () => {
    const key = newPageKey();
    expect(isNewPageKey(key)).toBe(true);
    expect(isNewPageKey("attachments/abc")).toBe(false);
    expect(newPageKey()).not.toBe(key);
  });
});

describe("DrawingSheet with pages", () => {
  it("numbers the memo's drawings as pages and opens on the one asked for", () => {
    render(
      <DrawingSheet
        mode="edit"
        pages={[
          { key: "a", content: { scene } },
          { key: "b", content: { scene } },
        ]}
        initialPage="b"
        onDone={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("group", { name: "editor.drawing.pages" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "editor.drawing.page 2" })).toHaveAttribute("aria-pressed", "true");
    // Only the page on show is mounted until another is shown.
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("img", { name: pageLabel(2) })).toBeInTheDocument();
  });

  it("reads a page the first time it is shown, and keeps the page it left mounted, hidden", async () => {
    const load = vi.fn(async () => ({ scene }));
    render(
      <DrawingSheet
        mode="edit"
        pages={[
          { key: "a", content: { scene } },
          { key: "b", load },
        ]}
        initialPage="a"
        onDone={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(load).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "editor.drawing.page 2" }));

    await screen.findByRole("img", { name: pageLabel(2), hidden: true });
    expect(load).toHaveBeenCalledTimes(1);
    const first = screen.getByRole("img", { name: pageLabel(1), hidden: true });
    expect(first.parentElement).toHaveClass("invisible");
    expect(first.parentElement).toHaveAttribute("inert");
    // Text being typed on the page left stays there; its selection is cleared.
    expect(handleFor(pageLabel(1)).commitText).toHaveBeenCalled();
    expect(handleFor(pageLabel(1)).setSelection).toHaveBeenCalledWith([]);

    // Back again: no second read, and the same canvas.
    fireEvent.click(screen.getByRole("button", { name: "editor.drawing.page 1" }));
    expect(load).toHaveBeenCalledTimes(1);
    expect(handles).toHaveLength(2);
  });

  it("carries the chosen tool over to the next page", async () => {
    render(
      <DrawingSheet
        mode="edit"
        pages={[
          { key: "a", content: { scene } },
          { key: "b", content: { scene } },
        ]}
        initialPage="a"
        onDone={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "editor.drawing.tool-rectangle" }));

    fireEvent.click(screen.getByRole("button", { name: "editor.drawing.page 2" }));

    await waitFor(() => expect(handleFor(pageLabel(2)).setTool).toHaveBeenLastCalledWith("rectangle"));
  });

  it("adds a blank page after the one on show, and Done exports only the pages that changed", async () => {
    const onDone = vi.fn();
    render(
      <DrawingSheet
        mode="edit"
        pages={[
          { key: "a", content: { scene } },
          { key: "b", content: { scene } },
        ]}
        initialPage="a"
        onDone={onDone}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "editor.drawing.add-page" }));

    // The new page is page 2, on show, blank; the old page 2 is now page 3.
    expect(screen.getByRole("button", { name: "editor.drawing.page 2" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("button", { name: /^editor\.drawing\.page \d$/ })).toHaveLength(3);
    const added = await screen.findByRole("img", { name: pageLabel(2) });
    expect(added).toHaveAttribute("data-scene", "no");

    act(() => {
      handleFor(pageLabel(2)).dirty = true;
    });
    fireEvent.click(screen.getByRole("button", { name: "editor.drawing.done" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    const { order, files } = onDone.mock.calls[0][0] as { order: string[]; files: { key: string; file: File }[] };
    expect(order).toHaveLength(3);
    expect(order[0]).toBe("a");
    expect(isNewPageKey(order[1])).toBe(true);
    expect(order[2]).toBe("b");
    // Page 1 was shown but left as it was; page 3 was never shown.
    expect(files.map((item) => item.key)).toEqual([order[1]]);
    expect(handleFor(pageLabel(1)).exportPng).not.toHaveBeenCalled();
  });

  it("adds a page after the last page when the last page is on show", async () => {
    const onDone = vi.fn();
    render(
      <DrawingSheet
        mode="edit"
        pages={[
          { key: "a", content: { scene } },
          { key: "b", content: { scene } },
        ]}
        initialPage="b"
        onDone={onDone}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "editor.drawing.add-page" }));
    fireEvent.click(screen.getByRole("button", { name: "editor.drawing.done" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    const { order } = onDone.mock.calls[0][0] as { order: string[] };
    expect(order.slice(0, 2)).toEqual(["a", "b"]);
    expect(isNewPageKey(order[2])).toBe(true);
    expect(screen.getByRole("button", { name: "editor.drawing.page 3" })).toHaveAttribute("aria-pressed", "true");
  });

  it("drops an added page left blank", async () => {
    const onDone = vi.fn();
    render(<DrawingSheet mode="new" pages={[{ key: "a" }]} initialPage="a" onDone={onDone} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "editor.drawing.add-page" }));
    fireEvent.click(screen.getByRole("button", { name: "editor.drawing.done" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(onDone.mock.calls[0][0].files).toEqual([]);
  });

  it("asks before discarding when a page that is not on show has changes", async () => {
    const onClose = vi.fn();
    render(
      <DrawingSheet
        mode="edit"
        pages={[
          { key: "a", content: { scene } },
          { key: "b", content: { scene } },
        ]}
        initialPage="a"
        onDone={vi.fn()}
        onClose={onClose}
      />,
    );
    act(() => {
      handleFor(pageLabel(1)).dirty = true;
    });
    fireEvent.click(screen.getByRole("button", { name: "editor.drawing.page 2" }));
    await screen.findByRole("img", { name: pageLabel(2) });

    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByText("editor.drawing.discard-edit-title")).toBeInTheDocument();
  });

  it("offers to read a page again when it could not be read", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ scene });
    render(
      <DrawingSheet
        mode="edit"
        pages={[
          { key: "a", content: { scene } },
          { key: "b", load },
        ]}
        initialPage="a"
        onDone={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "editor.drawing.page 2" }));
    fireEvent.click(await screen.findByRole("button", { name: "common.retry" }));

    expect(await screen.findByRole("img", { name: pageLabel(2) })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
