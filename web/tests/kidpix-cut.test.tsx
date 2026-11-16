import { act, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CutTool, { type CutToolHandle } from "@/components/DrawingSheet/kidpix/CutTool";
import { CUT_OPTION_COUNT, closesPolygon, cutBounds, cutPath, cutterBox, cutterOf } from "@/components/DrawingSheet/kidpix/cut";
import { KIDPIX_CUTTERS } from "@/components/DrawingSheet/kidpix/cutters";
import type { KidPixEngine } from "@/components/DrawingSheet/kidpix/engine";
import { KIDPIX_KINDS } from "@/components/DrawingSheet/kidpix/kinds";

describe("the scissors' shapes", () => {
  it("offers four shapes to draw and the disc's ten cookie cutters", () => {
    expect(KIDPIX_CUTTERS).toHaveLength(10);
    expect(CUT_OPTION_COUNT).toBe(14);
    expect([0, 3, 4, 13, 14].map(cutterOf)).toEqual([-1, -1, 0, 9, -1]);
    // The square cutter is 64 px a side, as measured in the original.
    expect(KIDPIX_CUTTERS[0].slice(2)).toEqual([64, 64]);
  });

  it("cuts a cutter at its own size, centered on the click", () => {
    expect(cutterBox(0, { x: 100, y: 80 })).toEqual({ x: 68, y: 48, width: 64, height: 64 });
  });

  it("keeps a shape to the paper and drops a slip of the hand", () => {
    expect(
      cutBounds(
        [
          { x: -20, y: 10.4 },
          { x: 50.2, y: 300 },
        ],
        200,
        100,
      ),
    ).toEqual({ x: 0, y: 10, width: 51, height: 90 });
    expect(
      cutBounds(
        [
          { x: 10, y: 10 },
          { x: 11, y: 40 },
        ],
        200,
        100,
      ),
    ).toBeNull();
    expect(cutBounds([], 200, 100)).toBeNull();
  });

  it("closes a polygon on its first corner once it has three", () => {
    const corners = [
      { x: 10, y: 10 },
      { x: 60, y: 10 },
      { x: 60, y: 60 },
    ];
    expect(closesPolygon(corners, { x: 14, y: 12 })).toBe(true);
    expect(closesPolygon(corners, { x: 40, y: 40 })).toBe(false);
    expect(closesPolygon(corners.slice(0, 2), { x: 10, y: 10 })).toBe(false);
  });

  it("draws its outline at the screen's scale", () => {
    expect(
      cutPath(
        [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
        2,
        true,
      ),
    ).toBe("M2 4L6 8Z");
  });

  it("has the Grab tool's hand and scissors in the tray, each with its three scripts and clips", () => {
    expect(KIDPIX_KINDS.grab.kinds).toHaveLength(2);
    for (const kind of KIDPIX_KINDS.grab.kinds) {
      expect(kind.sounds).toHaveLength(3);
      for (const cell of [...kind.putDown, ...kind.pickUp, ...kind.wiggle]) expect(KIDPIX_KINDS.grab.cells[cell]).toBeDefined();
    }
  });
});

describe("CutTool", () => {
  const getContext = HTMLCanvasElement.prototype.getContext;
  const toDataURL = HTMLCanvasElement.prototype.toDataURL;
  const piece = () => Object.assign(document.createElement("canvas"), { width: 40, height: 30 });
  const engine = { lift: vi.fn(piece), stick: vi.fn(), undo: vi.fn(() => true) };
  const play = vi.fn();

  beforeEach(() => {
    // jsdom has no canvas: every pixel of a mask counts as part of its shape.
    const ctx = { fillRect: vi.fn(), fillStyle: "", getImageData: () => ({ data: [0, 0, 0, 255] }) };
    HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as typeof getContext;
    HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,AA==";
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 }) as DOMRect;
    vi.clearAllMocks();
  });
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = getContext;
    HTMLCanvasElement.prototype.toDataURL = toDataURL;
  });

  const mount = () => {
    const ref = createRef<CutToolHandle>();
    const view = render(
      <CutTool
        ref={ref}
        active
        option={3}
        width={400}
        height={300}
        zoom={1}
        engine={() => engine as unknown as KidPixEngine}
        audio={() => null}
        play={play}
        cursors={["crosshair", "move", "move"]}
        onPress={() => undefined}
      />,
    );
    const sheet = view.container.querySelector(".kidpix-cut") as HTMLElement;
    const at = (x: number, y: number) => ({ button: 0, clientX: x, clientY: y, pointerId: 1 });
    const drag = (from: [number, number], to: [number, number]) => {
      fireEvent.pointerDown(sheet, at(...from));
      fireEvent.pointerMove(sheet, at(...to));
      fireEvent.pointerUp(sheet, at(...to));
    };
    return { ref, sheet, at, drag, piece: () => view.container.querySelector<HTMLElement>(".kidpix-cut-piece") };
  };

  it("marks a dragged rectangle without touching the paint, and says so", () => {
    const tool = mount();
    tool.drag([100, 100], [140, 130]);
    expect(tool.piece()?.style).toMatchObject({ left: "100px", top: "100px", width: "40px", height: "30px" });
    expect(tool.piece()?.hasAttribute("data-lifted")).toBe(false);
    expect(engine.lift).not.toHaveBeenCalled();
    expect(play).toHaveBeenCalledWith("w7428");
    expect(tool.ref.current?.holding()).toBe(false);
  });

  it("lifts the paint when the marked part is dragged, and sticks it at a press elsewhere", () => {
    const tool = mount();
    tool.drag([100, 100], [140, 130]);
    tool.drag([110, 110], [210, 160]);
    expect(engine.lift).toHaveBeenCalledWith(expect.anything(), 100, 100, true);
    expect(tool.piece()?.style).toMatchObject({ left: "200px", top: "150px" });
    expect(tool.ref.current?.holding()).toBe(true);
    fireEvent.pointerDown(tool.sheet, tool.at(20, 20));
    expect(engine.stick).toHaveBeenCalledWith(expect.anything(), 200, 150, false);
    expect(tool.piece()).toBeNull();
  });

  it("throws the marked part away with the Trash Can, and Undo Guy puts a lifted piece back", () => {
    const tool = mount();
    tool.drag([100, 100], [140, 130]);
    act(() => tool.ref.current?.trash());
    expect(engine.lift).toHaveBeenCalledWith(expect.anything(), 100, 100, true);
    expect(tool.piece()).toBeNull();
    expect(tool.ref.current?.undo()).toBe(false);

    tool.drag([100, 100], [140, 130]);
    tool.drag([110, 110], [210, 160]);
    let undone = false;
    act(() => {
      undone = tool.ref.current?.undo() ?? false;
    });
    expect(undone).toBe(true);
    expect(engine.undo).toHaveBeenCalledTimes(1);
    expect(engine.stick).not.toHaveBeenCalled();
    expect(tool.piece()).toBeNull();
  });

  it("copies with Duplicate and drops the copy in the middle of the paper with Paste", () => {
    const tool = mount();
    act(() => tool.ref.current?.paste());
    expect(tool.piece()).toBeNull();
    tool.drag([100, 100], [140, 130]);
    act(() => tool.ref.current?.duplicate());
    expect(engine.lift).toHaveBeenCalledWith(expect.anything(), 100, 100, false);
    act(() => tool.ref.current?.paste());
    expect(tool.piece()?.style).toMatchObject({ left: "180px", top: "135px" });
    // The copy is a step of its own once it is stuck down.
    act(() => tool.ref.current?.settle());
    expect(engine.stick).toHaveBeenCalledWith(expect.anything(), 180, 135, true);
  });
});
