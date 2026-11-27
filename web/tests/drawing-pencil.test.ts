import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { FreedrawElement } from "@usememos/canvas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FREEDRAW_HOOK_KEY, hookCanvasSource } from "@/components/DrawingSheet/pencil/canvasHook";
import { GRAIN_LEVELS, GRAIN_SIDE, grain, grainLevel, grainTile } from "@/components/DrawingSheet/pencil/grain";
import { isPencilStroke, pencilBands } from "@/components/DrawingSheet/pencil/strokes";

const stroke = (points: number[][], extra: Record<string, unknown> = {}) =>
  ({
    id: "a",
    type: "freedraw",
    x: 10,
    y: 20,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: "#1a1a1a",
    backgroundColor: "transparent",
    strokeWidth: 2.6,
    opacity: 70,
    isDeleted: false,
    groupIds: [],
    boundElements: [],
    seed: 1,
    locked: false,
    points,
    simulatePressure: false,
    customData: { gzTool: "pencil" },
    ...extra,
  }) as unknown as FreedrawElement;

describe("the paper's tooth", () => {
  it("matches GZreader's Sketch.grain", () => {
    // Worked out with GZreader's own formula (gzreader_sketch.lua) for these page pixels.
    const lua = (a: number, b: number) => {
      let h = Number((BigInt(a) * 374761393n) & 0xffffffffn) ^ Number((BigInt(b) * 668265263n) & 0xffffffffn);
      h ^= h >>> 15;
      h = Number((BigInt(h & 0xffff) * 40503n + BigInt(h >>> 16) * 30011n) & 0xffffffffn) | 0;
      h ^= h >>> 13;
      return (h & 0xffff) / 65536;
    };
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [17, 200],
      [255, 255],
      [128, 3],
    ]) {
      expect(grain(x, y)).toBeCloseTo(0.65 * lua(x, y) + 0.35 * lua(x >> 1, (y >> 1) + 7919), 6);
    }
    // It repeats every 256 pixels and is spread over 0 to 1.
    expect(grain(300, 600)).toBe(grain(300 - GRAIN_SIDE, 600 - 2 * GRAIN_SIDE));
    let sum = 0;
    for (let i = 0; i < 4096; i++) sum += grain(i % 64, i >> 6);
    expect(sum / 4096).toBeGreaterThan(0.4);
    expect(sum / 4096).toBeLessThan(0.6);
  });

  it("marks more of the paper at each darker step, and everything a lighter one marks", () => {
    const marked = (level: number) => grainTile(level, [10, 20, 30]).filter((_, i) => i % 4 === 3);
    const count = (pixels: Uint8ClampedArray) => pixels.reduce((n, alpha) => n + (alpha ? 1 : 0), 0);
    const light = marked(grainLevel(0.3));
    const dark = marked(grainLevel(0.8));
    expect(count(marked(0))).toBe(0);
    expect(count(marked(GRAIN_LEVELS))).toBe(GRAIN_SIDE * GRAIN_SIDE);
    expect(count(light)).toBeGreaterThan(0.2 * light.length);
    expect(count(dark)).toBeGreaterThan(count(light));
    expect(light.every((alpha, i) => !alpha || dark[i] === 255)).toBe(true);
    expect([...grainTile(GRAIN_LEVELS, [10, 20, 30]).slice(0, 4)]).toEqual([10, 20, 30, 255]);
  });
});

describe("a GZreader pencil stroke", () => {
  it("is known by the mark GZreader leaves, not by being see-through", () => {
    expect(isPencilStroke(stroke([[0, 0, 0.5]]))).toBe(true);
    expect(isPencilStroke(stroke([[0, 0, 0.5]], { customData: { gzTool: "highlighter" } }))).toBe(false);
    expect(isPencilStroke(stroke([[0, 0, 0.5]], { customData: undefined }))).toBe(false);
    expect(isPencilStroke({ type: "rectangle", customData: { gzTool: "pencil" } })).toBe(false);
  });

  it("is wider and darker the harder the pen pressed", () => {
    const widest = (pressure: number) =>
      pencilBands(
        stroke([
          [0, 0, pressure],
          [10, 0, pressure],
        ]),
      )[0];
    const light = widest(0);
    const heavy = widest(1);
    expect(heavy.lineWidth).toBeGreaterThan(light.lineWidth);
    expect(heavy.level).toBeGreaterThan(light.level);
    // Medium thickness, half pressure: GZreader's disc of radius 4, nine Kindle pixels across.
    expect(widest(0.5).lineWidth).toBe(4.5);
  });

  it("is thinner at its edges: a lighter band the whole width, a darker one in the middle", () => {
    const bands = pencilBands(
      stroke([
        [0, 0, 0.5],
        [10, 0, 0.5],
        [20, 5, 0.5],
      ]),
    );
    expect(bands).toHaveLength(2);
    expect(bands[0].lineWidth).toBeGreaterThan(bands[1].lineWidth);
    expect(bands[0].level).toBeLessThan(bands[1].level);
    // A point by itself, then each stretch between two points.
    expect(bands[0].segments).toEqual([0, 0, 0, 0, 0, 0, 10, 0, 10, 0, 20, 5]);
  });

  it("widens and lightens where the pen was laid over", () => {
    const points = [
      [0, 0, 0.5],
      [10, 0, 0.5],
    ];
    const upright = pencilBands(stroke(points))[0];
    const tilted = pencilBands(stroke(points, { customData: { gzTool: "pencil", gzTilt: [1, 1] } }))[0];
    expect(tilted.lineWidth).toBeGreaterThan(3 * upright.lineWidth);
    expect(tilted.level).toBeLessThan(upright.level);
    // Tilts that don't match the points are left out.
    expect(pencilBands(stroke(points, { customData: { gzTool: "pencil", gzTilt: [1] } }))[0]).toEqual(upright);
  });

  it("draws an even line when the stroke has no pressure", () => {
    const bands = pencilBands(
      stroke(
        [
          [0, 0, 0.1],
          [10, 0, 0.9],
          [20, 0, 0.4],
        ],
        { simulatePressure: true },
      ),
    );
    expect(bands).toHaveLength(2);
  });
});

describe("the drawing engine's hook", () => {
  const source = readFileSync(createRequire(import.meta.url).resolve("@usememos/canvas"), "utf8");

  it("is put where the installed engine fills a pen stroke", () => {
    const hooked = hookCanvasSource(source);
    expect(hooked).not.toBeNull();
    expect(hooked).toContain(`globalThis[Symbol.for("${FREEDRAW_HOOK_KEY}")]?.(`);
    expect(hooked?.length).toBeGreaterThan(source.length);
    // Once: a file already hooked, or one without the place, is refused.
    expect(hookCanvasSource(hooked ?? "")).toBeNull();
    expect(hookCanvasSource("export const nothing = 1;")).toBeNull();
  });

  it("asks the hook first and falls back to the engine's own fill", () => {
    const hooked = hookCanvasSource("f(e)?(t.fillStyle=e.strokeColor,t.fill(p(e))):g(e)");
    expect(hooked).toBe(`f(e)?(t.fillStyle=e.strokeColor,globalThis[Symbol.for("${FREEDRAW_HOOK_KEY}")]?.(t,e)||t.fill(p(e))):g(e)`);
  });
});

describe("drawing a pencil stroke", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("strokes each band with the paper's tooth, solid, and leaves other strokes to the engine", async () => {
    class FakePath {
      calls: unknown[][] = [];
      moveTo(...args: number[]) {
        this.calls.push(["moveTo", ...args]);
      }
      lineTo(...args: number[]) {
        this.calls.push(["lineTo", ...args]);
      }
    }
    class FakeMatrix {
      constructor(public values: number[]) {}
    }
    vi.stubGlobal("Path2D", FakePath);
    vi.stubGlobal("DOMMatrix", FakeMatrix);
    const tileCtx = { createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(tileCtx as never);
    const { drawPencilStroke } = await import("@/components/DrawingSheet/pencil");
    expect((globalThis as Record<symbol, unknown>)[Symbol.for(FREEDRAW_HOOK_KEY)]).toBe(drawPencilStroke);

    const setTransform = vi.fn();
    const strokes: { lineWidth: number; alpha: number; path: FakePath }[] = [];
    const ctx = {
      globalAlpha: 0.7,
      lineWidth: 0,
      lineCap: "",
      lineJoin: "",
      strokeStyle: null as unknown,
      save: vi.fn(),
      restore: vi.fn(),
      createPattern: vi.fn(() => ({ setTransform })),
      stroke(path: FakePath) {
        strokes.push({ lineWidth: this.lineWidth, alpha: this.globalAlpha, path });
      },
    };
    const pencil = stroke([
      [0, 0, 0.5],
      [10, 0, 0.5],
    ]);
    expect(drawPencilStroke(ctx as never, pencil)).toBe(true);
    expect(strokes.map((s) => s.lineWidth)).toEqual(pencilBands(pencil).map((band) => band.lineWidth));
    // The stroke's 70% was for the flat line; the specks are solid.
    expect(strokes.every((s) => Math.abs(s.alpha - 1) < 1e-9)).toBe(true);
    expect(strokes[0].path.calls).toEqual([
      ["moveTo", 0, 0],
      ["lineTo", 0, 0],
      ["moveTo", 0, 0],
      ["lineTo", 10, 0],
    ]);
    // One tile pixel for each Kindle pixel, placed by the page, not by the stroke.
    expect((setTransform.mock.calls[0][0] as FakeMatrix).values).toEqual([0.5, 0, 0, 0.5, -10, -20]);
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);

    expect(drawPencilStroke(ctx as never, stroke([[0, 0, 0.5]], { customData: undefined }))).toBe(false);
    expect(ctx.save).toHaveBeenCalledTimes(1);
  });
});
