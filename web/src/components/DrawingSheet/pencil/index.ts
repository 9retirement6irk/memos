/**
 * GZreader's pencil in the drawing sheet and the drawing viewer.
 *
 * A drawing made on a Kindle with GZreader keeps each pencil stroke as an ordinary pen stroke
 * marked `customData.gzTool: "pencil"`. The picture in the file shows the pencil as the Kindle
 * drew it, graphite specks on the paper's tooth, but the sheet and the viewer draw from the
 * strokes, where it was a flat see-through line. This draws those strokes the Kindle's way:
 * the same tooth (`grain.ts`), and the width and darkness GZreader gives each stretch of the
 * line from the pen's pressure and tilt (`strokes.ts`). The strokes themselves are unchanged,
 * so they still move, resize and erase, and a drawing saved here keeps the texture in its picture.
 *
 * Importing this module turns it on (see `canvasHook.ts` for how the engine is reached).
 */
import type { FreedrawElement } from "@usememos/canvas";
import { FREEDRAW_HOOK_KEY, type FreedrawHook } from "./canvasHook";
import { GRAIN_SIDE, grainTile } from "./grain";
import { isPencilStroke, type PencilBand, PIXELS_PER_UNIT, pencilBands } from "./strokes";

type Ctx = Parameters<FreedrawHook>[0];

/** memos' ink; the Kindle's pencil specks in it are this dark grey. */
const INK = "#1a1a1a";
const INK_SPECK: readonly [number, number, number] = [0x34, 0x34, 0x34];

const speckColour = (strokeColor: string): readonly [number, number, number] => {
  const hex = /^#([0-9a-f]{6})$/i.exec(strokeColor)?.[1];
  if (!hex || strokeColor.toLowerCase() === INK) return INK_SPECK;
  const value = Number.parseInt(hex, 16);
  return [value >> 16, (value >> 8) & 0xff, value & 0xff];
};

// A tile of specks for each colour and darkness in use. A page of pencil has a handful.
const MAX_PATTERNS = 256;
const patterns = new Map<string, CanvasPattern | null>();

const patternFor = (ctx: Ctx, strokeColor: string, level: number): CanvasPattern | null => {
  const rgb = speckColour(strokeColor);
  const key = `${rgb.join(",")}/${level}`;
  const known = patterns.get(key);
  if (known !== undefined) return known;
  const tile = document.createElement("canvas");
  tile.width = GRAIN_SIDE;
  tile.height = GRAIN_SIDE;
  const tileCtx = tile.getContext("2d");
  let pattern: CanvasPattern | null = null;
  if (tileCtx) {
    const image = tileCtx.createImageData(GRAIN_SIDE, GRAIN_SIDE);
    image.data.set(grainTile(level, rgb));
    tileCtx.putImageData(image, 0, 0);
    pattern = ctx.createPattern(tile, "repeat");
  }
  if (patterns.size >= MAX_PATTERNS) patterns.clear();
  patterns.set(key, pattern);
  return pattern;
};

interface DrawnBand extends PencilBand {
  path: Path2D;
}

// Worked out once per stroke: moving a stroke makes a new element with the same points.
const drawn = new WeakMap<object, { strokeWidth: number; bands: DrawnBand[] }>();

const bandsFor = (element: FreedrawElement): DrawnBand[] => {
  const known = drawn.get(element.points);
  if (known && known.strokeWidth === element.strokeWidth) return known.bands;
  const bands = pencilBands(element).map((band) => {
    const path = new Path2D();
    for (let i = 0; i < band.segments.length; i += 4) {
      path.moveTo(band.segments[i], band.segments[i + 1]);
      path.lineTo(band.segments[i + 2], band.segments[i + 3]);
    }
    return { ...band, path };
  });
  drawn.set(element.points, { strokeWidth: element.strokeWidth, bands });
  return bands;
};

/** Draws a GZreader pencil stroke as graphite; false for any other stroke, which the engine then draws. */
export const drawPencilStroke: FreedrawHook = (ctx, candidate) => {
  const element = candidate as FreedrawElement;
  if (!isPencilStroke(element) || !Array.isArray(element.points) || element.points.length === 0) return false;
  const bands = bandsFor(element);
  ctx.save();
  // The specks are solid, as on the Kindle: the stroke's own see-through level was for the flat line.
  const opacity = Math.max(0, Math.min(100, element.opacity ?? 100)) / 100;
  if (opacity > 0) ctx.globalAlpha = Math.min(1, ctx.globalAlpha / opacity);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // The tooth belongs to the page, one tile pixel for each Kindle pixel, wherever the stroke is.
  const size = GRAIN_SIDE / PIXELS_PER_UNIT;
  const place = new DOMMatrix([1 / PIXELS_PER_UNIT, 0, 0, 1 / PIXELS_PER_UNIT, -(element.x % size), -(element.y % size)]);
  for (const band of bands) {
    const pattern = patternFor(ctx, element.strokeColor, band.level);
    if (!pattern) continue;
    pattern.setTransform(place);
    ctx.strokeStyle = pattern;
    ctx.lineWidth = band.lineWidth;
    ctx.stroke(band.path);
  }
  ctx.restore();
  return true;
};

(globalThis as Record<symbol, unknown>)[Symbol.for(FREEDRAW_HOOK_KEY)] = drawPencilStroke;
