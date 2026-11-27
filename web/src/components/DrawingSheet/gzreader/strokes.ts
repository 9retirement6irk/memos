/**
 * A stroke drawn with one of GZreader's writing tools, worked out as GZreader's drawing
 * screen paints it (`gzreader_sketch.lua`, `gzreader_drawscreen.lua`): how wide, and for the
 * pencil how dark, each stretch of the line is from the pen's pressure and tilt there.
 * No canvas here, so it tests without one.
 */
import type { FreedrawElement } from "@usememos/canvas";
import { grainLevel } from "./grain";

/** Kindle pixels per drawing unit: GZreader draws a page at 2, as memos exports it. */
export const PIXELS_PER_UNIT = 2;
/** memos draws a stroke whose width follows its speed at this share of its full width. */
const SPEED_WIDTH = 0.42;

/** How a tool draws: GZreader's `Sketch.TOOL_STYLE`. */
export interface ToolStyle {
  /** Its line against the pen's at the same thickness. */
  scale: number;
  /** The line's width from the lightest to the heaviest press, as a share of its own. Without them the line is even. */
  lightest?: number;
  heaviest?: number;
  /** Pressure is raised to this first: the fountain pen stays thin until pressed, then swells. */
  curve?: number;
  /** Laid right over, the line is this many times as wide. */
  tiltWidth?: number;
  /** Graphite: specks on the paper's tooth. Laid right over, it is `tiltLight` lighter. */
  grain?: { tiltLight: number };
  /**
   * A see-through wash laid over what is under it, which stays as dark as it was: the grey it
   * reads as in memos' ink (0 black to 255 paper), and how strongly any other colour shows.
   */
  wash?: { grey: number; tint: number };
}

/**
 * The tools GZreader marks its strokes with. Its pen leaves no mark and is memos' own pen
 * stroke, so the engine draws it.
 */
export const TOOL_STYLES = {
  pencil: { scale: 1.3, lightest: 0.75, heaviest: 1.2, tiltWidth: 4, grain: { tiltLight: 0.45 } },
  fountain: { scale: 1, lightest: 0.15, heaviest: 2.8, curve: 1.6 },
  marker: { scale: 1.9, tiltWidth: 2 },
  highlighter: { scale: 3.5, wash: { grey: 0xc8, tint: 0.55 } },
  shader: { scale: 5, wash: { grey: 0xe6, tint: 0.3 } },
} as const satisfies Record<string, ToolStyle>;

export type GzTool = keyof typeof TOOL_STYLES;

/** The GZreader tool a stroke was drawn with, by the mark GZreader leaves (`customData.gzTool`). */
export const gzToolOf = (element: { type: string; customData?: unknown }): GzTool | undefined => {
  const data = element.customData;
  if (element.type !== "freedraw" || typeof data !== "object" || data === null) return undefined;
  const tool = (data as { gzTool?: unknown }).gzTool;
  return typeof tool === "string" && Object.hasOwn(TOOL_STYLES, tool) ? (tool as GzTool) : undefined;
};

/** Each point's tilt, 0 upright to 1 laid over, when the stroke carries one for every point. */
const tiltsOf = (element: FreedrawElement): readonly number[] | undefined => {
  const tilts = (element as { customData?: { gzTilt?: unknown } }).customData?.gzTilt;
  return Array.isArray(tilts) && tilts.length === element.points.length ? (tilts as number[]) : undefined;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

/**
 * The pencil is thinner at its edges: GZreader lowers the share of paper marked from the
 * middle of the line (all of it) to the rim (0.55 of it). Drawn here as two bands, the whole
 * width at the rim half's average and the middle at the middle's.
 */
const GRAIN_BANDS: readonly { width: number; cover: number }[] = [
  { width: 1, cover: 0.71 },
  { width: 0.62, cover: 0.93 },
];

/** One band of the line: stretches of one width (and darkness), in the element's own units. */
export interface StrokeBand {
  /** Line width in drawing units. */
  lineWidth: number;
  /** For the pencil, the grain step it is filled with (`grainLevel`). */
  level?: number;
  /** x1, y1, x2, y2 for each stretch. */
  segments: number[];
}

/** The bands that draw a stroke with `tool`, widest (and lightest) first. */
export const strokeBands = (element: FreedrawElement, tool: GzTool): StrokeBand[] => {
  const style: ToolStyle = TOOL_STYLES[tool];
  const { points } = element;
  const tilts = tiltsOf(element);
  const pressed = element.simulatePressure === false && style.lightest !== undefined && style.heaviest !== undefined;
  // memos is given the tool's own width; the thickness chosen on the Kindle is that over its scale.
  const thickness = Math.max(0.25, Math.min(12, (Number(element.strokeWidth) || 2) / style.scale));
  const penRadius = Math.max(1, Math.round(((2 + thickness * 3) * SPEED_WIDTH * PIXELS_PER_UNIT) / 2));
  const bands = new Map<string, StrokeBand>();
  const add = (lineWidth: number, level: number | undefined, a: readonly number[], b: readonly number[]) => {
    const key = `${lineWidth}/${level ?? ""}`;
    let band = bands.get(key);
    if (!band) {
      band = { lineWidth, level, segments: [] };
      bands.set(key, band);
    }
    band.segments.push(a[0], a[1], b[0], b[1]);
  };
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[i];
    const weight = pressed ? clamp01((a[2] + b[2]) / 2) : undefined;
    const tilt = tilts ? clamp01((tilts[Math.max(0, i - 1)] + tilts[i]) / 2) : 0;
    const base = penRadius * style.scale * (1 + ((style.tiltWidth ?? 1) - 1) * tilt);
    const press =
      weight === undefined ? 1 : (style.lightest ?? 1) + ((style.heaviest ?? 1) - (style.lightest ?? 1)) * weight ** (style.curve ?? 1);
    const radius = Math.max(1, Math.round(base * press));
    // A disc of that radius covers 2r + 1 pixels.
    const width = (2 * radius + 1) / PIXELS_PER_UNIT;
    if (!style.grain) {
      add(width, undefined, a, b);
      continue;
    }
    const cover = (0.38 + 0.47 * (weight ?? 0.5)) * (1 - style.grain.tiltLight * tilt);
    for (const band of GRAIN_BANDS) {
      const level = grainLevel(cover * band.cover);
      if (level > 0) add(width * band.width, level, a, b);
    }
  }
  return [...bands.values()].sort((x, y) => y.lineWidth - x.lineWidth || (x.level ?? 0) - (y.level ?? 0));
};

const INK = "#1a1a1a";

/**
 * The colour a wash is laid in: memos' ink shows as the tool's own grey, any other colour
 * at the tool's strength over white. Laid by multiplying, what is under it stays as dark.
 */
export const washColour = (strokeColor: string, wash: { grey: number; tint: number }): string => {
  const hex = /^#([0-9a-f]{6})$/i.exec(strokeColor)?.[1];
  const channels =
    !hex || strokeColor.toLowerCase() === INK
      ? [wash.grey, wash.grey, wash.grey]
      : [0, 2, 4].map((at) => Math.round(255 - wash.tint * (255 - Number.parseInt(hex.slice(at, at + 2), 16))));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
};
