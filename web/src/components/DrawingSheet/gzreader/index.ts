/**
 * GZreader's writing tools in the drawing sheet and the drawing viewer.
 *
 * A drawing made on a Kindle with GZreader keeps each stroke as an ordinary pen stroke, marked
 * with its tool (`customData.gzTool`). The picture in the file shows the tools as the Kindle
 * drew them, but the sheet and the viewer draw from the strokes, where every tool was the
 * engine's one smooth line, see-through for some. This draws the marked strokes the Kindle's
 * way (`strokes.ts`):
 *
 * - the pencil as graphite specks on the paper's tooth (`grain.ts`), wider and lighter laid over;
 * - the fountain pen thin until pressed, then swelling;
 * - the marker even all along, broader laid over;
 * - the highlighter and the shader as an even wash that leaves what is under it as dark as it was.
 *
 * GZreader's pen leaves no mark and stays the engine's. The strokes themselves are unchanged,
 * so they still move, resize and erase, and a drawing saved here keeps the look in its picture.
 *
 * Importing this module turns it on (see `canvasHook.ts` for how the engine is reached).
 */
import type { FreedrawElement } from "@usememos/canvas";
import { FREEDRAW_HOOK_KEY, type FreedrawHook } from "./canvasHook";
import { GRAIN_SIDE, grainTile } from "./grain";
import { type GzTool, gzToolOf, PIXELS_PER_UNIT, type StrokeBand, strokeBands, TOOL_STYLES, type ToolStyle, washColour } from "./strokes";

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

interface DrawnBand extends StrokeBand {
  path: Path2D;
}

// Worked out once per stroke: moving a stroke makes a new element with the same points.
const drawn = new WeakMap<object, { strokeWidth: number; tool: GzTool; bands: DrawnBand[] }>();

const bandsFor = (element: FreedrawElement, tool: GzTool): DrawnBand[] => {
  const known = drawn.get(element.points);
  if (known && known.strokeWidth === element.strokeWidth && known.tool === tool) return known.bands;
  const bands = strokeBands(element, tool).map((band) => {
    const path = new Path2D();
    for (let i = 0; i < band.segments.length; i += 4) {
      path.moveTo(band.segments[i], band.segments[i + 1]);
      path.lineTo(band.segments[i + 2], band.segments[i + 3]);
    }
    return { ...band, path };
  });
  drawn.set(element.points, { strokeWidth: element.strokeWidth, tool, bands });
  return bands;
};

/** Draws a stroke made with one of GZreader's tools as the Kindle does; false for any other stroke, which the engine then draws. */
export const drawGzStroke: FreedrawHook = (ctx, candidate) => {
  const element = candidate as FreedrawElement;
  const tool = gzToolOf(element);
  if (!tool || !Array.isArray(element.points) || element.points.length === 0) return false;
  const style: ToolStyle = TOOL_STYLES[tool];
  const bands = bandsFor(element, tool);
  ctx.save();
  // The Kindle's ink is solid: the stroke's own see-through level was for the engine's flat line.
  const opacity = Math.max(0, Math.min(100, element.opacity ?? 100)) / 100;
  if (opacity > 0) ctx.globalAlpha = Math.min(1, ctx.globalAlpha / opacity);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (style.wash) {
    // Multiplied, so writing under a highlight stays as dark, and a wash over a wash is deeper.
    ctx.globalCompositeOperation = "multiply";
    ctx.strokeStyle = washColour(element.strokeColor, style.wash);
  } else {
    ctx.strokeStyle = element.strokeColor;
  }
  // The tooth belongs to the page, one tile pixel for each Kindle pixel, wherever the stroke is.
  const size = GRAIN_SIDE / PIXELS_PER_UNIT;
  const place = style.grain
    ? new DOMMatrix([1 / PIXELS_PER_UNIT, 0, 0, 1 / PIXELS_PER_UNIT, -(element.x % size), -(element.y % size)])
    : undefined;
  for (const band of bands) {
    if (place && band.level !== undefined) {
      const pattern = patternFor(ctx, element.strokeColor, band.level);
      if (!pattern) continue;
      pattern.setTransform(place);
      ctx.strokeStyle = pattern;
    }
    ctx.lineWidth = band.lineWidth;
    ctx.stroke(band.path);
  }
  ctx.restore();
  return true;
};

(globalThis as Record<symbol, unknown>)[Symbol.for(FREEDRAW_HOOK_KEY)] = drawGzStroke;
