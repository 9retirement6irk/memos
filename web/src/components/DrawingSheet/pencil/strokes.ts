/**
 * A GZreader pencil stroke, worked out as GZreader's drawing screen paints it
 * (`gzreader_sketch.lua`, `gzreader_drawscreen.lua`): how wide and how dark each stretch of
 * the line is from the pen's pressure and tilt there. No canvas here, so it tests without one.
 */
import type { FreedrawElement } from "@usememos/canvas";
import { grainLevel } from "./grain";

/** Kindle pixels per drawing unit: GZreader draws a page at 2, as memos exports it. */
export const PIXELS_PER_UNIT = 2;
/** The pencil's line against the pen's at the same thickness (GZreader's `TOOL_STYLE.pencil`). */
const SCALE = 1.3;
/** The line's width from the lightest to the heaviest press, as a share of its own. */
const LIGHTEST = 0.75;
const HEAVIEST = 1.2;
/** Laid right over, the line is this many times as wide, and this much lighter. */
const TILT_WIDTH = 4;
const TILT_LIGHT = 0.45;
/** memos draws a stroke whose width follows its speed at this share of its full width. */
const SPEED_WIDTH = 0.42;
/**
 * The pencil is thinner at its edges: GZreader lowers the share of paper marked from the
 * middle of the line (all of it) to the rim (0.55 of it). Drawn here as two bands, the whole
 * width at the rim half's average and the middle at the middle's.
 */
const BANDS: readonly { width: number; cover: number }[] = [
  { width: 1, cover: 0.71 },
  { width: 0.62, cover: 0.93 },
];

/** The strokes GZreader marks as drawn with its pencil. */
export const isPencilStroke = (element: { type: string; customData?: unknown }): boolean => {
  const data = element.customData;
  return element.type === "freedraw" && typeof data === "object" && data !== null && (data as { gzTool?: unknown }).gzTool === "pencil";
};

/** Each point's tilt, 0 upright to 1 laid over, when the stroke carries one for every point. */
const tiltsOf = (element: FreedrawElement): readonly number[] | undefined => {
  const tilts = (element as { customData?: { gzTilt?: unknown } }).customData?.gzTilt;
  return Array.isArray(tilts) && tilts.length === element.points.length ? (tilts as number[]) : undefined;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

/** One band of the line: stretches of one width and darkness, in the element's own units. */
export interface PencilBand {
  /** Line width in drawing units. */
  lineWidth: number;
  /** The grain step it is filled with (`grainLevel`). */
  level: number;
  /** x1, y1, x2, y2 for each stretch. */
  segments: number[];
}

/** The bands that draw a pencil stroke, widest and lightest first. */
export const pencilBands = (element: FreedrawElement): PencilBand[] => {
  const { points } = element;
  const tilts = tiltsOf(element);
  const pressured = element.simulatePressure === false;
  // memos is given the pencil's own width; the thickness chosen on the Kindle is that over its scale.
  const thickness = Math.max(0.25, Math.min(12, (Number(element.strokeWidth) || 2) / SCALE));
  const penRadius = Math.max(1, Math.round(((2 + thickness * 3) * SPEED_WIDTH * PIXELS_PER_UNIT) / 2));
  const bands = new Map<string, PencilBand>();
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[i];
    const weight = pressured ? clamp01((a[2] + b[2]) / 2) : undefined;
    const tilt = tilts ? clamp01((tilts[Math.max(0, i - 1)] + tilts[i]) / 2) : 0;
    const base = penRadius * SCALE * (1 + (TILT_WIDTH - 1) * tilt);
    const radius = Math.max(1, Math.round(weight === undefined ? base : base * (LIGHTEST + (HEAVIEST - LIGHTEST) * weight)));
    const cover = (0.38 + 0.47 * (weight ?? 0.5)) * (1 - TILT_LIGHT * tilt);
    for (const band of BANDS) {
      // A disc of that radius covers 2r + 1 pixels.
      const lineWidth = ((2 * radius + 1) * band.width) / PIXELS_PER_UNIT;
      const level = grainLevel(cover * band.cover);
      if (level === 0) continue;
      const key = `${lineWidth}/${level}`;
      let entry = bands.get(key);
      if (!entry) {
        entry = { lineWidth, level, segments: [] };
        bands.set(key, entry);
      }
      entry.segments.push(a[0], a[1], b[0], b[1]);
    }
  }
  return [...bands.values()].sort((x, y) => y.lineWidth - x.lineWidth || x.level - y.level);
};
