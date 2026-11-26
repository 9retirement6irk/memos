import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { FreedrawElement } from "@usememos/canvas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FREEDRAW_HOOK_KEY, hookCanvasSource } from "@/components/DrawingSheet/gzreader/canvasHook";
import { GRAIN_LEVELS, GRAIN_SIDE, grain, grainLevel, grainTile } from "@/components/DrawingSheet/gzreader/grain";
import { gzToolOf, type StrokeBand, strokeBands, washColour } from "@/components/DrawingSheet/gzreader/strokes";

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

/** A pencil stroke's bands, each with its grain step. */
const pencilBands = (element: FreedrawElement): (StrokeBand & { level: number })[] =>
  strokeBands(element, "pencil").map((band) => ({ ...band, level: band.level ?? Number.NaN }));
const isPencilStroke = (element: { type: string; customData?: unknown }) => gzToolOf(element) === "pencil";

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
    expect(gzToolOf(stroke([[0, 0, 0.5]], { customData: { gzTool: "highlighter" } }))).toBe("highlighter");
    // The pen leaves no mark, and a mark that isn't a tool's is no tool.
    expect(gzToolOf(stroke([[0, 0, 0.5]], { customData: { gzTool: "pen" } }))).toBeUndefined();
    expect(gzToolOf(stroke([[0, 0, 0.5]], { customData: { gzTool: "constructor" } }))).toBeUndefined();
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

describe("GZreader's other tools", () => {
  const line = (pressure: number, extra: Record<string, unknown>) =>
    strokeBands(
      stroke(
        [
          [0, 0, pressure],
          [10, 0, pressure],
        ],
        extra,
      ),
      (extra.customData as { gzTool: "fountain" | "marker" | "highlighter" | "shader" }).gzTool,
    );

  it("the fountain pen stays thin until pressed, then swells", () => {
    const fountain = (pressure: number) => line(pressure, { strokeWidth: 2, opacity: 100, customData: { gzTool: "fountain" } });
    // Medium: the pen's radius is 3 Kindle pixels; 0.15 of it lightest, 2.8 times it heaviest.
    expect(fountain(0).map((band) => band.lineWidth)).toEqual([1.5]);
    expect(fountain(0.5)[0].lineWidth).toBe(3.5);
    expect(fountain(1)[0].lineWidth).toBe(8.5);
    expect(fountain(0.5)[0].level).toBeUndefined();
  });

  it("the marker is even whatever the pressure, and broader laid over", () => {
    const marker = (pressure: number, tilt?: number[]) =>
      line(pressure, { strokeWidth: 3.8, opacity: 100, customData: { gzTool: "marker", ...(tilt ? { gzTilt: tilt } : {}) } });
    expect(marker(0.1)).toEqual(marker(0.9));
    expect(marker(0.5)).toHaveLength(1);
    expect(marker(0.5)[0].lineWidth).toBe(6.5);
    expect(marker(0.5, [1, 1])[0].lineWidth).toBe(11.5);
  });

  it("the highlighter and the shader are one even band each", () => {
    const highlighter = line(0.9, { strokeWidth: 7, opacity: 35, customData: { gzTool: "highlighter" } });
    const shader = line(0.2, { strokeWidth: 10, opacity: 20, customData: { gzTool: "shader" } });
    expect(highlighter).toHaveLength(1);
    expect(shader).toHaveLength(1);
    expect(highlighter[0].lineWidth).toBe(11.5);
    expect(shader[0].lineWidth).toBe(15.5);
    // One path for the whole stroke, so it doesn't darken where it crosses itself.
    expect(highlighter[0].segments).toHaveLength(8);
  });

  it("a wash is the tool's grey in memos' ink and a tint of any other colour", () => {
    expect(washColour("#1a1a1a", { grey: 0xc8, tint: 0.55 })).toBe("#c8c8c8");
    expect(washColour("#ffff00", { grey: 0xc8, tint: 0.55 })).toBe("#ffff73");
    expect(washColour("#0000ff", { grey: 0xe6, tint: 0.3 })).toBe("#b3b3ff");
    expect(washColour("not a colour", { grey: 0xe6, tint: 0.3 })).toBe("#e6e6e6");
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

describe("drawing a GZreader stroke", () => {
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
    const { drawGzStroke: drawPencilStroke } = await import("@/components/DrawingSheet/gzreader");
    expect((globalThis as Record<symbol, unknown>)[Symbol.for(FREEDRAW_HOOK_KEY)]).toBe(drawPencilStroke);

    const setTransform = vi.fn();
    const strokes: { lineWidth: number; alpha: number; path: FakePath; style: unknown; mode: string }[] = [];
    const ctx = {
      globalAlpha: 0.7,
      lineWidth: 0,
      lineCap: "",
      lineJoin: "",
      strokeStyle: null as unknown,
      globalCompositeOperation: "source-over",
      save: vi.fn(),
      restore: vi.fn(),
      createPattern: vi.fn(() => ({ setTransform })),
      stroke(path: FakePath) {
        strokes.push({
          lineWidth: this.lineWidth,
          alpha: this.globalAlpha,
          path,
          style: this.strokeStyle,
          mode: this.globalCompositeOperation,
        });
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

    expect(strokes.every((s) => s.mode === "source-over")).toBe(true);

    expect(drawPencilStroke(ctx as never, stroke([[0, 0, 0.5]], { customData: undefined }))).toBe(false);
    expect(ctx.save).toHaveBeenCalledTimes(1);

    // A highlighter: one solid band, multiplied over what is under it, in its wash colour.
    strokes.length = 0;
    ctx.globalAlpha = 0.35;
    const highlight = stroke(
      [
        [0, 0, 0.5],
        [10, 0, 0.5],
      ],
      { strokeWidth: 7, opacity: 35, strokeColor: "#ffff00", customData: { gzTool: "highlighter" } },
    );
    expect(drawPencilStroke(ctx as never, highlight)).toBe(true);
    expect(strokes).toHaveLength(1);
    expect(strokes[0]).toMatchObject({ lineWidth: 11.5, style: "#ffff73", mode: "multiply" });
    expect(strokes[0].alpha).toBeCloseTo(1);

    // A fountain pen: the stroke's own colour, drawn over.
    strokes.length = 0;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    expect(
      drawPencilStroke(ctx as never, stroke([[0, 0, 0.5]], { strokeWidth: 2, opacity: 100, customData: { gzTool: "fountain" } })),
    ).toBe(true);
    expect(strokes[0]).toMatchObject({ lineWidth: 3.5, style: "#1a1a1a", mode: "source-over" });
  });
});
