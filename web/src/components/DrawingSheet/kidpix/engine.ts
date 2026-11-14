import type { KidPixAudio } from "./audio";
import {
  BOX_BRUSHES,
  type BoxMemo,
  type BrushEnv,
  brushBox,
  brushDown,
  brushSegment,
  newBoxMemo,
  newStroke,
  type Point,
  type StrokeState,
} from "./brushes";
import { type Box, floodMask, type MixEffect, mixPixels, paintBounds, planTiles } from "./raster";
import { RealisticBrushes } from "./realistic";
import type { SwfPicture } from "./swf";
import {
  ERASER_SIZES,
  MARKER_LEAN,
  MARKER_TIPS,
  MIXER_EFFECTS,
  PENCIL_NIBS,
  PENCIL_SHAPES,
  PENCIL_WIDTHS,
  REALISTIC_COUNT,
  TEXT_LINE,
  type TextStyle,
  TOOL_NUMBER,
  textFont,
  WAND_EFFECTS,
  WAND_SIZES,
} from "./tools";

/** The sprite sheets the paint tools read pixels from. Each may still be loading. */
export interface KidPixImages {
  /** 7 x 7 grid of 160 px pattern tiles. */
  fills?: HTMLImageElement;
  /** 7 x 6 grid of 160 px tiles for the Solid bucket: how much of the color lands on each pixel. */
  solidTiles?: HTMLImageElement;
  /** A strip of 48 px gradient swatches. */
  gradients?: HTMLImageElement;
  /** A strip of 48 px letter stamps, A to Z, as alpha masks. */
  letters?: HTMLImageElement;
  /** The Realistic brushes' 60 tips, as alpha masks (see tips.ts). */
  tips?: HTMLImageElement;
  /** The pieces the Bricks, Log, Door and Roof brushes are built from, and the Window brush's frame. */
  brushParts?: HTMLImageElement;
  brushWindow?: HTMLImageElement;
}

/** Something the layer can hold in a frame and press into the paint: a sticker, or a picture brought in. */
export type KidPixPicture = Pick<SwfPicture, "width" | "height" | "draw">;

export interface KidPixTile extends Box {
  blob: Blob;
}

interface EngineOptions {
  paper: string;
  /** A canvas under the paint and over the drawing, for a Kid Pix background. */
  backgroundCanvas: HTMLCanvasElement;
  /** The drawing's own canvases, for the Paint Can and the mixers to see what is under the paint. */
  backdropSources: () => HTMLCanvasElement[];
  images: KidPixImages;
  audio: KidPixAudio;
  fontFamily: string;
}

type Stroke =
  | { kind: "pencil"; size: number; nib: number; last: Point; carry: { run: number } }
  | { kind: "brush"; brush: number; size: number; last: Point; state: StrokeState; carry: { run: number } }
  | { kind: "box"; brush: number; start: Point; last: Point; base: ImageData; memo: BoxMemo }
  | { kind: "eraser"; size: number; round: boolean; last: Point }
  | { kind: "wand"; size: number; last: Point; mixed: CanvasPattern | null }
  | { kind: "move"; start: Point; paint: ImageData }
  | { kind: "shape"; shape: number; size: number; nib: number; start: Point; last: Point; base: ImageData }
  | { kind: "bend"; size: number; nib: number; from: Point; to: Point; base: ImageData }
  | { kind: "spray"; sheet: HTMLImageElement; frames: SprayFrames; last: Point; timer: number; dropped?: (frame: SprayFrame) => void };

/** A shape that takes more than one press: a curve waiting to be bent, or a polygon gathering corners. */
type Pending =
  | { shape: "curve"; tool: number; size: number; nib: number; from: Point; to: Point; base: ImageData }
  | { shape: "polygon"; tool: number; filled: boolean; size: number; nib: number; points: Point[]; base: ImageData };

/** A press this close (px) to a polygon's first corner closes it. */
const POLYGON_CLOSE = 12;

/**
 * A picture of a spray set: where it is in its sheet (x, y, width, height) and, for moving
 * paint, where its corner lands from the pointer (x, y) and the clip it plays. See `spray.ts`.
 */
export type SprayFrame = readonly number[];
export type SprayFrames = readonly SprayFrame[];

/** Kid Pix's can drops a picture this often (ms) for as long as it is held, whether or not the pointer moves. */
const SPRAY_TICK = 108;

/** One undo step: the paint, and the background behind it. */
interface Snapshot {
  paint: ImageData;
  background: HTMLImageElement | null;
}

const HISTORY_STEPS = 12;
/** Rubber stamps are 32 px bitmaps, stamped at twice their size, as Kid Pix's middle size does. */
const STAMP_CELL = 32;
const STAMP_SIZE = 64;

/** The width a kind of pencil draws at one of the three sizes. */
const pencilWidth = (nib: number, sizeIndex: number) => (PENCIL_WIDTHS[nib] ?? PENCIL_WIDTHS[0])[sizeIndex] ?? PENCIL_WIDTHS[0][1];

/** A nib's pixels around its center: as rows to fill, and one by one for the kinds that lay grains. */
interface NibMask {
  rows: readonly (readonly [number, number, number])[];
  pixels: readonly (readonly [number, number])[];
  alpha: number;
}
const nibMasks = new Map<string, NibMask>();
/** The pencil, chalk and crayon press a hard-edged disc; the marker a thin slanted oval. */
const nibMask = (nib: number, size: number): NibMask => {
  const key = `${nib}:${size}`;
  const known = nibMasks.get(key);
  if (known) return known;
  const tip = nib === 3 ? MARKER_TIPS[Math.max(0, PENCIL_WIDTHS[3].indexOf(size))] : undefined;
  const half = size / 2;
  const sin = Math.sin(MARKER_LEAN);
  const cos = Math.cos(MARKER_LEAN);
  const rows: [number, number, number][] = [];
  const pixels: [number, number][] = [];
  const origin = -Math.floor(half);
  for (let row = 0; row < size; row++) {
    let first = -1;
    let length = 0;
    for (let column = 0; column < size; column++) {
      const dx = column + 0.5 - half;
      const dy = row + 0.5 - half;
      const along = dx * sin + dy * cos;
      const across = dx * cos - dy * sin;
      const inside = tip ? (across / tip[0]) ** 2 + (along / half) ** 2 <= 1 : dx * dx + dy * dy <= half * half || size === 1;
      if (!inside) continue;
      if (first < 0) first = column;
      length = column - first + 1;
      pixels.push([origin + column, origin + row]);
    }
    if (first >= 0) rows.push([origin + row, origin + first, length]);
  }
  const mask = { rows, pixels, alpha: tip ? tip[1] : (PENCIL_NIBS[nib] ?? PENCIL_NIBS[0]).alpha };
  nibMasks.set(key, mask);
  return mask;
};

const scratch = (width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("No 2D context for the Kid Pix layer");
  return { canvas, ctx };
};

/** An image, once it can be drawn from. */
const loaded = (image: HTMLImageElement | undefined) => (image?.complete && image.naturalWidth ? image : null);

/** What the ABC brush writes until Kid Pix's "Edit ABC Text" is built. */
const ABC_TEXT = "Kid Pix ";

const rgb = (hex: string): [number, number, number] => {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

/**
 * The Kid Pix paint layer: a bitmap over the drawing, one pixel per drawing px. Every tool
 * paints here; when the session ends the sheet lifts the paint off as picture tiles and adds
 * them to the drawing (see `takeTiles`).
 */
export class KidPixEngine {
  color = "#ff0080";
  private readonly ctx: CanvasRenderingContext2D;
  private readonly undoStack: Snapshot[] = [];
  private readonly redoStack: Snapshot[] = [];
  private background: HTMLImageElement | null = null;
  private backdrop: HTMLCanvasElement | null = null;
  private stroke: Stroke | null = null;
  private pending: Pending | null = null;
  private hue = 0;
  private readonly realistic = new RealisticBrushes(() => this.options.images.tips);

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: EngineOptions,
  ) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("No 2D context for the Kid Pix layer");
    this.ctx = ctx;
  }

  private get width() {
    return this.canvas.width;
  }

  private get height() {
    return this.canvas.height;
  }

  private get audio() {
    return this.options.audio;
  }

  /** True once any paint, or a background, is on the layer. */
  hasPaint() {
    if (this.background) return true;
    return paintBounds(this.ctx.getImageData(0, 0, this.width, this.height).data, this.width, this.height) !== null;
  }

  /** Saves the layer before a change, as one undo step. */
  private remember() {
    this.settle();
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > HISTORY_STEPS) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  private snapshot(): Snapshot {
    return { paint: this.ctx.getImageData(0, 0, this.width, this.height), background: this.background };
  }

  /**
   * Drops a shape left half-made (a curve not yet bent, a polygon not yet closed) and the undo
   * step it took. True if there was one.
   */
  settle() {
    const pending = this.pending;
    if (!pending) return false;
    this.pending = null;
    this.ctx.putImageData(pending.base, 0, 0);
    this.undoStack.pop();
    this.audio.toolDrop();
    return true;
  }

  undo() {
    // Taking back a half-made shape is the undo.
    if (this.settle()) return true;
    const previous = this.undoStack.pop();
    if (!previous) return false;
    this.redoStack.push(this.snapshot());
    this.ctx.putImageData(previous.paint, 0, 0);
    if (previous.background !== this.background) this.showBackground(previous.background);
    return true;
  }

  /**
   * A Kid Pix background goes behind the paint. It would hide the drawing too, so the drawing
   * is copied over it: the picture reads as paper swapped for the background.
   */
  setBackground(image: HTMLImageElement | null) {
    if (image === this.background) return;
    this.remember();
    this.showBackground(image);
    this.audio.play("misc31500");
  }

  private showBackground(image: HTMLImageElement | null) {
    const canvas = this.options.backgroundCanvas;
    const ctx = canvas.getContext("2d");
    this.background = image;
    this.backdrop = null;
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!image) return;
    // Cover the layer, cropping the picture's longer side.
    const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    const [width, height] = [image.naturalWidth * scale, image.naturalHeight * scale];
    ctx.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    this.drawSources(ctx);
  }

  private drawSources(ctx: CanvasRenderingContext2D) {
    for (const source of this.options.backdropSources()) {
      if (source.width && source.height) ctx.drawImage(source, 0, 0, this.width, this.height);
    }
  }

  /** The drawing under the paint, captured once: the layer covers it for the whole session. */
  private underPaint() {
    if (this.backdrop) return this.backdrop;
    const { canvas, ctx } = scratch(this.width, this.height);
    ctx.fillStyle = this.options.paper;
    ctx.fillRect(0, 0, this.width, this.height);
    if (this.background) ctx.drawImage(this.options.backgroundCanvas, 0, 0);
    else this.drawSources(ctx);
    this.backdrop = canvas;
    return canvas;
  }

  /** The picture as the person sees it: paper, drawing and paint. */
  private composite(box: Box = { x: 0, y: 0, width: this.width, height: this.height }) {
    const { canvas, ctx } = scratch(box.width, box.height);
    ctx.drawImage(this.underPaint(), -box.x, -box.y);
    ctx.drawImage(this.canvas, -box.x, -box.y);
    return { canvas, ctx };
  }

  private brushEnv(): BrushEnv {
    return {
      color: this.color,
      parts: loaded(this.options.images.brushParts),
      windowArt: loaded(this.options.images.brushWindow),
      text: ABC_TEXT,
      random: Math.random,
    };
  }

  // ---- strokes -------------------------------------------------------------------------

  /** `nib` is the kind of pencil: 0 pencil, 1 chalk, 2 crayon, 3 marker. */
  pencilDown(at: Point, sizeIndex: number, nib = 0) {
    this.remember();
    this.stroke = { kind: "pencil", size: pencilWidth(nib, sizeIndex), nib, last: at, carry: { run: 0 } };
    this.audio.toolDown(TOOL_NUMBER.pencil + nib);
    this.move(at);
  }

  /** `sizeIndex` is the tray's size for the brushes that have one: Kid Pix's Realistic ones. */
  brushDown(at: Point, brush: number, sizeIndex = 1) {
    this.remember();
    if (BOX_BRUSHES.has(brush)) {
      // Dragged out like a rectangle: the picture is redrawn in the box until it is let go.
      const base = this.ctx.getImageData(0, 0, this.width, this.height);
      this.stroke = { kind: "box", brush, start: at, last: at, base, memo: newBoxMemo(at, performance.now(), Math.random) };
      this.audio.toolDown(brush);
      // A press alone already shows: Madona's pyramid from above, say.
      this.move(at);
      return;
    }
    this.stroke = { kind: "brush", brush, size: sizeIndex, last: at, state: newStroke(at, this.hue), carry: { run: 0 } };
    this.audio.toolDown(brush);
    brushDown(this.ctx, brush, at, this.brushEnv());
    this.move(at);
  }

  /** The Little Eraser. It takes the paint away with a round or a square tip, and sounds like the pencil. */
  eraserDown(at: Point, sizeIndex: number, round = false) {
    this.remember();
    this.stroke = { kind: "eraser", size: ERASER_SIZES[sizeIndex] ?? ERASER_SIZES[1], round, last: at };
    this.audio.toolDown(PENCIL_SHAPES[0].tool);
    this.move(at);
  }

  /**
   * A mixer wand, as Kid Pix's works: the effect lands once on whatever the wand passes over,
   * however often it passes. So the whole picture is mixed up front and the wand uncovers it.
   * The Smear wand has no picture to uncover; it drags what is under it along.
   */
  wandDown(at: Point, wand: number, sizeIndex = 0) {
    this.remember();
    const effect = WAND_EFFECTS[wand] ?? "blur";
    let mixed: CanvasPattern | null = null;
    if (effect !== "smear") {
      const { canvas, ctx } = this.composite();
      const pixels = ctx.getImageData(0, 0, this.width, this.height);
      mixPixels(pixels.data, this.width, this.height, effect, rgb(this.color));
      ctx.putImageData(pixels, 0, 0);
      mixed = this.ctx.createPattern(canvas, "no-repeat");
    }
    this.stroke = { kind: "wand", size: WAND_SIZES[sizeIndex] ?? WAND_SIZES[0], last: at, mixed };
    this.audio.toolDown(TOOL_NUMBER.firstWand + wand);
    this.move(at);
  }

  /**
   * The Spray Can, timed as Kid Pix's is: one picture from the set, picked at random, the moment
   * it goes down and every `SPRAY_TICK` after. A 3D shape lands centered on the pointer; moving
   * paint lands where its animation would have carried it. `dropped` hears of each picture.
   */
  sprayDown(at: Point, sheet: HTMLImageElement, frames: SprayFrames, dropped?: (frame: SprayFrame) => void) {
    if (!sheet.complete || !sheet.naturalWidth || frames.length === 0) return;
    this.remember();
    const timer = window.setInterval(() => this.sprayOne(), SPRAY_TICK);
    this.stroke = { kind: "spray", sheet, frames, last: at, timer, dropped };
    this.sprayOne();
  }

  private sprayOne() {
    const stroke = this.stroke;
    if (stroke?.kind !== "spray") return;
    const frame = stroke.frames[Math.floor(Math.random() * stroke.frames.length)];
    const [x, y, width, height, dx = -width / 2, dy = -height / 2] = frame;
    this.ctx.drawImage(stroke.sheet, x, y, width, height, Math.round(stroke.last.x + dx), Math.round(stroke.last.y + dy), width, height);
    stroke.dropped?.(frame);
  }

  /** The Moving Van picks up all the paint; the drawing under it stays put. */
  moveDown(at: Point) {
    this.remember();
    this.stroke = { kind: "move", start: at, paint: this.ctx.getImageData(0, 0, this.width, this.height) };
    this.audio.play("w7429");
  }

  move(to: Point) {
    const stroke = this.stroke;
    if (!stroke) {
      // Between presses, a polygon's next side follows the pointer, and a curve bends toward it.
      if (this.pending?.shape === "polygon") this.polygonPreview(this.pending, to);
      else if (this.pending?.shape === "curve") this.bendPreview(this.pending, to);
      return;
    }
    const ctx = this.ctx;
    if (stroke.kind === "move") {
      ctx.clearRect(0, 0, this.width, this.height);
      ctx.putImageData(stroke.paint, Math.round(to.x - stroke.start.x), Math.round(to.y - stroke.start.y));
      return;
    }
    if (stroke.kind === "shape") {
      stroke.last = to;
      ctx.putImageData(stroke.base, 0, 0);
      const { kind, filled } = PENCIL_SHAPES[stroke.shape];
      if (kind === "line" || kind === "curve") this.pencilPath([stroke.start, to], stroke.size, stroke.nib, false, false);
      else this.pencilPath(this.shapePoints(kind, stroke.start, to), stroke.size, stroke.nib, true, filled);
      return;
    }
    if (stroke.kind === "bend") {
      this.bendPreview(stroke, to);
      return;
    }
    if (stroke.kind === "box") {
      ctx.putImageData(stroke.base, 0, 0);
      brushBox(ctx, stroke.brush, stroke.start, to, this.brushEnv(), stroke.memo, performance.now());
      const moved = { x: to.x - stroke.last.x, y: to.y - stroke.last.y };
      stroke.last = to;
      this.audio.toolMove(moved.x, moved.y);
      return;
    }
    if (stroke.kind === "spray") {
      // The can follows the pointer; its timer does the dropping.
      stroke.last = to;
      return;
    }
    if (stroke.kind === "pencil") {
      this.pencilSegment(stroke.last, to, stroke.size, stroke.nib, stroke.carry);
    } else if (stroke.kind === "brush") {
      // The Realistic brushes press their tips; until those have loaded, a stroke leaves nothing.
      if (stroke.brush < REALISTIC_COUNT) this.realistic.segment(ctx, stroke.brush, stroke.size, this.color, stroke.last, to, stroke.carry);
      else brushSegment(ctx, stroke.brush, stroke.last, to, stroke.state, this.brushEnv());
      this.hue = stroke.state.hue;
    } else if (stroke.kind === "eraser") {
      const steps = Math.max(1, Math.ceil(Math.hypot(to.x - stroke.last.x, to.y - stroke.last.y)));
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      for (let i = 0; i <= steps; i++) {
        const x = Math.round(stroke.last.x + ((to.x - stroke.last.x) * i) / steps);
        const y = Math.round(stroke.last.y + ((to.y - stroke.last.y) * i) / steps);
        if (stroke.round && stroke.size > 2) {
          for (const [dy, dx, length] of nibMask(0, stroke.size).rows) ctx.fillRect(x + dx, y + dy, length, 1);
        } else {
          ctx.fillRect(x - Math.floor(stroke.size / 2), y - Math.floor(stroke.size / 2), stroke.size, stroke.size);
        }
      }
      ctx.restore();
    } else {
      const still = to.x === stroke.last.x && to.y === stroke.last.y;
      ctx.save();
      if (stroke.mixed) {
        ctx.fillStyle = stroke.mixed;
        ctx.strokeStyle = stroke.mixed;
        ctx.lineWidth = stroke.size;
        ctx.lineCap = "round";
        ctx.beginPath();
        if (still) {
          ctx.arc(to.x, to.y, stroke.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.moveTo(stroke.last.x, stroke.last.y);
          ctx.lineTo(to.x, to.y);
          ctx.stroke();
        }
      } else if (!still) {
        // Smear: what is under the wand is carried along with it, thinning as it goes, 2 px at a time.
        const reach = Math.ceil(stroke.size / 2);
        const length = Math.hypot(to.x - stroke.last.x, to.y - stroke.last.y);
        const steps = Math.max(1, Math.round(length / 2));
        ctx.globalAlpha = 0.5;
        for (let step = 1; step <= steps; step++) {
          const from = {
            x: stroke.last.x + ((to.x - stroke.last.x) * (step - 1)) / steps,
            y: stroke.last.y + ((to.y - stroke.last.y) * (step - 1)) / steps,
          };
          const next = {
            x: stroke.last.x + ((to.x - stroke.last.x) * step) / steps,
            y: stroke.last.y + ((to.y - stroke.last.y) * step) / steps,
          };
          const behind = this.composite({
            x: Math.round(from.x) - reach,
            y: Math.round(from.y) - reach,
            width: reach * 2,
            height: reach * 2,
          }).canvas;
          ctx.save();
          ctx.beginPath();
          ctx.arc(next.x, next.y, stroke.size / 2, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(behind, Math.round(next.x) - reach, Math.round(next.y) - reach);
          ctx.restore();
        }
      }
      ctx.restore();
    }
    const moved = { x: to.x - stroke.last.x, y: to.y - stroke.last.y };
    stroke.last = to;
    this.audio.toolMove(moved.x, moved.y);
  }

  /**
   * The Pencil's shapes (`PENCIL_SHAPES`): a line, rectangle or oval is dragged out corner to
   * corner; a curve is dragged as a line, bends toward the pointer once let go and is set by a press; a polygon takes a press
   * for each corner and closes on a press at its first.
   */
  shapeDown(at: Point, shape: number, sizeIndex: number, nib = 0) {
    const size = pencilWidth(nib, sizeIndex);
    const kind = PENCIL_SHAPES[shape]?.kind ?? "free";
    if (kind === "free") {
      this.pencilDown(at, sizeIndex, nib);
      return;
    }
    const pending = this.pending;
    if (pending?.shape === "curve") {
      // The line has been bending toward the pointer since it was let go; a press sets it, where it is let go.
      this.stroke = { kind: "bend", size: pending.size, nib: pending.nib, from: pending.from, to: pending.to, base: pending.base };
      this.pending = null;
      this.move(at);
      return;
    }
    if (pending?.shape === "polygon") {
      const first = pending.points[0];
      if (pending.points.length >= 3 && Math.hypot(at.x - first.x, at.y - first.y) <= POLYGON_CLOSE) {
        this.pending = null;
        this.ctx.putImageData(pending.base, 0, 0);
        this.pencilPath(pending.points, pending.size, pending.nib, true, pending.filled);
        this.audio.toolUp();
        return;
      }
      pending.points.push(at);
      this.polygonPreview(pending, at);
      return;
    }
    this.remember();
    const base = this.ctx.getImageData(0, 0, this.width, this.height);
    const { tool, filled } = PENCIL_SHAPES[shape];
    if (kind === "polygon") {
      this.pending = { shape: "polygon", tool, filled, size, nib, points: [at], base };
      this.polygonPreview(this.pending, at);
      // Its sound runs from the first corner to the last, as a curve's does until it is set.
      this.audio.toolDown(tool);
      return;
    }
    this.audio.toolDown(tool);
    this.stroke = { kind: "shape", shape, size, nib, start: at, last: at, base };
  }

  /**
   * A dragged line bent toward the pointer, as Kid Pix bends it: a cubic curve with both of its
   * control points on the pointer, so it reaches three quarters of the way there.
   */
  private bendPreview(curve: { base: ImageData; from: Point; to: Point; size: number; nib: number }, at: Point) {
    this.ctx.putImageData(curve.base, 0, 0);
    const points = Array.from({ length: 33 }, (_, step) => {
      const t = step / 32;
      const u = 1 - t;
      const ends = u * u * u;
      const pull = 3 * u * t;
      return {
        x: ends * curve.from.x + pull * at.x + t * t * t * curve.to.x,
        y: ends * curve.from.y + pull * at.y + t * t * t * curve.to.y,
      };
    });
    this.pencilPath(points, curve.size, curve.nib, false, false);
  }

  /** The polygon so far, a line out to the pointer, and a ring on the corner that closes it. */
  private polygonPreview(pending: Extract<Pending, { shape: "polygon" }>, pointer: Point) {
    const ctx = this.ctx;
    ctx.putImageData(pending.base, 0, 0);
    this.pencilPath([...pending.points, pointer], pending.size, pending.nib, false, false);
    const first = pending.points[0];
    ctx.save();
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(first.x, first.y, POLYGON_CLOSE / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private shapePoints(kind: string, from: Point, to: Point): Point[] {
    if (kind === "rect") {
      return [from, { x: to.x, y: from.y }, to, { x: from.x, y: to.y }];
    }
    // An oval inside the dragged box.
    const cx = (from.x + to.x) / 2;
    const cy = (from.y + to.y) / 2;
    const rx = Math.abs(to.x - from.x) / 2;
    const ry = Math.abs(to.y - from.y) / 2;
    const steps = Math.max(24, Math.min(180, Math.ceil((rx + ry) / 3)));
    return Array.from({ length: steps }, (_, step) => {
      const angle = (step / steps) * Math.PI * 2;
      return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
    });
  }

  /** A path in the pencil's line: open or closed, and filled with the color if asked. */
  private pencilPath(points: readonly Point[], size: number, nib: number, closed: boolean, filled: boolean) {
    if (points.length < 2) return;
    const ctx = this.ctx;
    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
      if (closed) ctx.closePath();
    };
    if (filled) {
      ctx.save();
      ctx.fillStyle = this.color;
      // The marker stays see-through when it fills.
      if (nib === 3) ctx.globalAlpha = 0.6;
      trace();
      ctx.fill();
      ctx.restore();
      if (nib === 3) return;
    }
    // Every kind draws a shape's line as it draws any other: its nib, pressed along the path.
    const ends = closed ? [...points, points[0]] : points;
    const carry = { run: 0 };
    for (let index = 1; index < ends.length; index++) this.pencilSegment(ends[index - 1], ends[index], size, nib, carry);
  }

  /** One press of a kind's nib, as Kid Pix lays it: a solid disc, a scatter of grains, or the marker's tip. */
  private pencilPress(x: number, y: number, size: number, nib: number) {
    const ctx = this.ctx;
    const mask = nibMask(nib, size);
    const left = Math.round(x);
    const top = Math.round(y);
    ctx.globalAlpha = mask.alpha;
    if (nib === 1 || nib === 2) {
      const grains = Math.max(1, Math.round(mask.pixels.length * PENCIL_NIBS[nib].share));
      for (let grain = 0; grain < grains; grain++) {
        const [dx, dy] = mask.pixels[Math.floor(Math.random() * mask.pixels.length)];
        ctx.fillRect(left + dx, top + dy, 1, 1);
      }
      return;
    }
    for (const [dy, dx, length] of mask.rows) ctx.fillRect(left + dx, top + dy, length, 1);
  }

  /**
   * A line in a kind's own mark: presses of its nib, `spacing` apart. `carry` is how far the
   * line has run since its last press, so a stroke's presses stay evenly spaced across segments.
   */
  private pencilSegment(from: Point, to: Point, size: number, nib: number, carry: { run: number } = { run: 0 }) {
    const ctx = this.ctx;
    const spacing = (PENCIL_NIBS[nib] ?? PENCIL_NIBS[0]).spacing;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    ctx.save();
    ctx.fillStyle = this.color;
    if (carry.run === 0 && length === 0) this.pencilPress(from.x, from.y, size, nib);
    let at = carry.run === 0 ? 0 : spacing - carry.run;
    for (; at <= length && length > 0; at += spacing) {
      this.pencilPress(from.x + ((to.x - from.x) * at) / length, from.y + ((to.y - from.y) * at) / length, size, nib);
    }
    // Never zero after a press, so the next segment does not press the same spot again.
    if (length > 0 || carry.run === 0) carry.run = Math.max(1e-6, length === 0 ? 0 : spacing - (at - length));
    ctx.restore();
  }

  up() {
    const stroke = this.stroke;
    this.stroke = null;
    if (!stroke) return;
    if (stroke.kind === "shape" && PENCIL_SHAPES[stroke.shape].kind === "curve") {
      const { tool } = PENCIL_SHAPES[stroke.shape];
      this.pending = { shape: "curve", tool, size: stroke.size, nib: stroke.nib, from: stroke.start, to: stroke.last, base: stroke.base };
      // The line stays, waiting to be bent; a press without a drag leaves nothing to bend.
      if (Math.hypot(stroke.last.x - stroke.start.x, stroke.last.y - stroke.start.y) < 2) this.settle();
      return;
    }
    if (stroke.kind === "spray") window.clearInterval(stroke.timer);
    else if (stroke.kind === "move") this.audio.play("w7430");
    else this.audio.toolUp();
  }

  // ---- one-shot tools ------------------------------------------------------------------

  /**
   * The Fill Buckets. Solid (bucket 0) lays the color in hand through one of 42 one-color
   * patterns, the first of which is plain; Blend (1) is a gradient; Pattern (2) a many-colored tile.
   */
  fill(at: Point, bucket: number, option: number) {
    const { fills, gradients, solidTiles } = this.options.images;
    const source = scratch(this.width, this.height);
    const picture = this.composite().ctx.getImageData(0, 0, this.width, this.height);
    const { mask, box } = floodMask(picture.data, this.width, this.height, at.x, at.y);
    if (bucket === 0) {
      if (option === 0) {
        source.ctx.fillStyle = "#fff";
      } else {
        if (!solidTiles?.complete || !solidTiles.naturalWidth) return;
        const tile = scratch(158, 158);
        tile.ctx.drawImage(solidTiles, (option % 7) * 160 + 1, Math.floor(option / 7) * 160 + 1, 158, 158, 0, 0, 158, 158);
        const pattern = source.ctx.createPattern(tile.canvas, "repeat");
        if (!pattern) return;
        source.ctx.fillStyle = pattern;
      }
      source.ctx.fillRect(box.x, box.y, box.width, box.height);
      // The tile is how much color lands: none leaves what was there, so a second color can go over a first.
      const amount = source.ctx.getImageData(0, 0, this.width, this.height).data;
      const [red, green, blue] = rgb(this.color);
      this.remember();
      const paint = this.ctx.getImageData(0, 0, this.width, this.height);
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue;
        const j = i * 4;
        const over = amount[j] / 255;
        if (over === 0) continue;
        const under = (paint.data[j + 3] / 255) * (1 - over);
        const alpha = over + under;
        paint.data[j] = (red * over + paint.data[j] * under) / alpha;
        paint.data[j + 1] = (green * over + paint.data[j + 1] * under) / alpha;
        paint.data[j + 2] = (blue * over + paint.data[j + 2] * under) / alpha;
        paint.data[j + 3] = alpha * 255;
      }
      this.ctx.putImageData(paint, 0, 0);
      this.audio.toolOnce(TOOL_NUMBER.fillSolid);
      return;
    }
    if (bucket === 2) {
      if (!fills?.complete || !fills.naturalWidth) return;
      // A pixel in from each edge: neighbors in the sheet bleed into a tile's rim.
      const tile = scratch(158, 158);
      tile.ctx.drawImage(fills, (option % 7) * 160 + 1, Math.floor(option / 7) * 160 + 1, 158, 158, 0, 0, 158, 158);
      const pattern = source.ctx.createPattern(tile.canvas, "repeat");
      if (!pattern) return;
      source.ctx.fillStyle = pattern;
      source.ctx.fillRect(box.x, box.y, box.width, box.height);
    } else {
      if (!gradients?.complete || !gradients.naturalWidth) return;
      source.ctx.drawImage(gradients, option * 48 + 1, 1, 46, 46, box.x, box.y, box.width, box.height);
    }
    this.remember();
    const fillPixels = source.ctx.getImageData(0, 0, this.width, this.height).data;
    const paint = this.ctx.getImageData(0, 0, this.width, this.height);
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const j = i * 4;
      paint.data[j] = fillPixels[j];
      paint.data[j + 1] = fillPixels[j + 1];
      paint.data[j + 2] = fillPixels[j + 2];
      paint.data[j + 3] = 255;
    }
    this.ctx.putImageData(paint, 0, 0);
    this.audio.toolOnce(bucket === 2 ? TOOL_NUMBER.fillPattern : TOOL_NUMBER.fillGradient);
  }

  /** A whole-picture mixer: the result covers the drawing under it. */
  mix(mixer: number) {
    this.remember();
    this.mixRegion({ x: 0, y: 0, width: this.width, height: this.height }, MIXER_EFFECTS[mixer] ?? "invert");
    this.audio.toolOnce(TOOL_NUMBER.firstMixer + mixer);
  }

  private mixRegion(box: Box, effect: MixEffect) {
    const { canvas, ctx } = this.composite(box);
    const pixels = ctx.getImageData(0, 0, box.width, box.height);
    mixPixels(pixels.data, box.width, box.height, effect, rgb(this.color));
    ctx.putImageData(pixels, 0, 0);
    this.ctx.drawImage(canvas, box.x, box.y);
  }

  /** Stamps a letter (0 is A) in the current color. Kid Pix plays clip 7320 for any stamp. */
  stamp(at: Point, letter: number) {
    const sheet = this.options.images.letters;
    if (!sheet?.complete || !sheet.naturalWidth) return;
    this.remember();
    const { canvas, ctx } = scratch(48, 48);
    ctx.drawImage(sheet, letter * 48, 0, 48, 48, 0, 0, 48, 48);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = this.color;
    ctx.fillRect(0, 0, 48, 48);
    this.ctx.drawImage(canvas, at.x - 48, at.y - 48, 96, 96);
    this.audio.play("w7320");
  }

  /** Stamps one 32 px rubber stamp from a category's strip, with hard pixels. */
  stampFrom(at: Point, sheet: HTMLImageElement, index: number) {
    if (!sheet.complete || !sheet.naturalWidth) return;
    this.remember();
    this.ctx.save();
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(
      sheet,
      index * STAMP_CELL,
      0,
      STAMP_CELL,
      STAMP_CELL,
      at.x - STAMP_SIZE / 2,
      at.y - STAMP_SIZE / 2,
      STAMP_SIZE,
      STAMP_SIZE,
    );
    this.ctx.restore();
    this.audio.play("w7320");
  }

  /** Places a sticker at its own size, centered where the pointer came down. */
  /** Flattens a sticker, or a picture brought in, into the paint: in `box`, turned over if it was flipped. */
  sticker(picture: KidPixPicture, box: Box, flipX = false, flipY = false) {
    this.remember();
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(box.x + (flipX ? box.width : 0), box.y + (flipY ? box.height : 0));
    ctx.scale(((flipX ? -1 : 1) * box.width) / picture.width, ((flipY ? -1 : 1) * box.height) / picture.height);
    picture.draw(ctx);
    ctx.restore();
  }

  /** Sets typed text on the paint, its middle line at `at`. */
  /**
   * Presses a text box into the paint: its lines one under the other from `at`, the box's
   * top-left corner, set left, centered or right within the widest of them.
   */
  text(at: Point, value: string, style: TextStyle) {
    const lines = value.replace(/\s+$/, "").split("\n");
    if (lines.every((line) => !line.trim())) return;
    this.remember();
    const ctx = this.ctx;
    ctx.save();
    ctx.font = textFont(style);
    ctx.fillStyle = this.color;
    ctx.textBaseline = "middle";
    const widths = lines.map((line) => ctx.measureText(line).width);
    const box = Math.max(...widths);
    const lineHeight = style.size * TEXT_LINE;
    lines.forEach((line, index) => {
      const x = at.x + (style.align === "left" ? 0 : (box - widths[index]) / (style.align === "center" ? 2 : 1));
      const y = at.y + lineHeight * (index + 0.5);
      ctx.fillText(line, x, y);
      if (style.underline && widths[index] > 0) {
        const thick = Math.max(1, style.size / 14);
        ctx.fillRect(x, y + style.size * 0.42, widths[index], thick);
      }
    });
    ctx.restore();
  }

  /** Dynamite: every bit of paint goes at once. */
  clear() {
    this.remember();
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  /**
   * A screen eraser: the paint goes in a short animation, in one of four ways picked by the
   * eraser's place in the tray. Resolves when the paper is clear.
   */
  wipe(eraser: number): Promise<void> {
    this.remember();
    this.audio.toolOnce(TOOL_NUMBER.firstScreenEraser + eraser);
    const { ctx, width, height } = this;
    const started = performance.now();
    return new Promise((resolve) => {
      const frame = (now: number) => {
        const progress = Math.min(1, (now - started) / 550);
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = "#000000";
        if (eraser % 4 === 0) {
          ctx.beginPath();
          ctx.arc(width / 2, height / 2, Math.hypot(width, height) * 0.5 * progress, 0, Math.PI * 2);
          ctx.fill();
        } else if (eraser % 4 === 1) {
          ctx.fillRect(0, 0, width * progress, height);
        } else if (eraser % 4 === 2) {
          for (let y = 0; y < height; y += 40) ctx.fillRect(0, y, width, 40 * progress);
        } else {
          ctx.globalAlpha = 0.25;
          ctx.fillRect(0, 0, width, height);
        }
        ctx.restore();
        if (progress < 1) {
          requestAnimationFrame(frame);
          return;
        }
        ctx.clearRect(0, 0, width, height);
        resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  // ---- handing the paint to the drawing ------------------------------------------------

  /**
   * The paint as PNG tiles, each at most `maxSide` px a side, placed in layer px. Empty tiles
   * are left out; an empty layer gives none. A background comes along under the paint.
   */
  async takeTiles(maxSide: number): Promise<KidPixTile[]> {
    this.settle();
    // With a background the whole layer is the picture; without one, only where there is paint.
    const bounds = this.background
      ? { x: 0, y: 0, width: this.width, height: this.height }
      : paintBounds(this.ctx.getImageData(0, 0, this.width, this.height).data, this.width, this.height);
    if (!bounds) return [];
    const tiles: KidPixTile[] = [];
    for (const box of planTiles(bounds, maxSide)) {
      const { canvas, ctx } = scratch(box.width, box.height);
      if (this.background) ctx.drawImage(this.options.backgroundCanvas, -box.x, -box.y);
      ctx.drawImage(this.canvas, -box.x, -box.y);
      if (!paintBounds(ctx.getImageData(0, 0, box.width, box.height).data, box.width, box.height)) continue;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Could not encode the Kid Pix paint");
      tiles.push({ ...box, blob });
    }
    return tiles;
  }
}
