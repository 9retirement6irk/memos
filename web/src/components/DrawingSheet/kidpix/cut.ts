import type { Point } from "./brushes";
import { KIDPIX_CUTTERS } from "./cutters";

/**
 * The scissors' options, in the tray's order: four ways to draw a shape around part of the
 * picture, then the ten cookie cutters, which cut their own shape with one click.
 */
export const CUT_GESTURES = ["free", "polygon", "oval", "rectangle"] as const;
export type CutGesture = (typeof CUT_GESTURES)[number];
export const CUT_OPTION_COUNT = CUT_GESTURES.length + KIDPIX_CUTTERS.length;

/** The tool numbers KP.cfg gives the four, for their sounds. */
export const CUT_TOOL_NUMBERS: Readonly<Record<CutGesture, number>> = { free: 111, oval: 112, rectangle: 113, polygon: 114 };

/** The cutter an option is, or -1 for the four drawn shapes. */
export const cutterOf = (option: number) =>
  option >= CUT_GESTURES.length && option < CUT_OPTION_COUNT ? option - CUT_GESTURES.length : -1;

/** A press this close (px) to a polygon's first corner closes it, as with the Pencil's polygon. */
export const CUT_POLYGON_CLOSE = 12;
/** A shape smaller than this a side (px) is a slip of the hand, not a cut. */
export const CUT_SMALLEST = 3;

export interface CutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The whole pixels a shape through `points` covers, kept to the paper. Null when nothing is left. */
export const cutBounds = (points: readonly Point[], paperWidth: number, paperHeight: number): CutBox | null => {
  if (points.length === 0) return null;
  const left = Math.max(0, Math.floor(Math.min(...points.map((point) => point.x))));
  const top = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y))));
  const right = Math.min(paperWidth, Math.ceil(Math.max(...points.map((point) => point.x))));
  const bottom = Math.min(paperHeight, Math.ceil(Math.max(...points.map((point) => point.y))));
  if (right - left < CUT_SMALLEST || bottom - top < CUT_SMALLEST) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
};

/** Where a cutter lands when clicked at `at`: its own size, centered on the click. */
export const cutterBox = (cutter: number, at: Point): CutBox => {
  const [, , width, height] = KIDPIX_CUTTERS[cutter];
  return { x: Math.round(at.x - width / 2), y: Math.round(at.y - height / 2), width, height };
};

/** Whether a press at `at` closes a polygon with these corners. */
export const closesPolygon = (points: readonly Point[], at: Point) =>
  points.length >= 3 && Math.hypot(at.x - points[0].x, at.y - points[0].y) <= CUT_POLYGON_CLOSE;

/** An SVG path through `points`, scaled for the screen. */
export const cutPath = (points: readonly Point[], zoom: number, closed: boolean) =>
  points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x * zoom} ${point.y * zoom}`).join("") + (closed ? "Z" : "");
