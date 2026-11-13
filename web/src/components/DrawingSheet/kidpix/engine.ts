import type { KidPixAudio } from "./audio";
import { type BrushEnv, brushDown, brushSegment, newStroke, type Point, type StrokeState } from "./brushes";
import { type Box, floodMask, type MixEffect, mixPixels, paintBounds, planTiles } from "./raster";
import type { SwfPicture } from "./swf";
import { ERASER_SIZES, MIXER_EFFECTS, PENCIL_SIZES, TEXT_SIZE, TOOL_NUMBER, WAND_EFFECTS } from "./tools";

/** The sprite sheets the paint tools read pixels from. Each may still be loading. */
export interface KidPixImages {
  /** 7 x 7 grid of 160 px pattern tiles. */
  fills?: HTMLImageElement;
  /** A strip of 48 px gradient swatches. */
  gradients?: HTMLImageElement;
  /** A strip of 48 px letter stamps, A to Z, as alpha masks. */
  letters?: HTMLImageElement;
  /** The strip of 48 px brush icons, the source of the pattern brushes. */
  brushes?: HTMLImageElement;
}

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
  | { kind: "pencil"; size: number; nib: number; last: Point }
  | { kind: "brush"; brush: number; last: Point; state: StrokeState }
  | { kind: "eraser"; size: number; last: Point }
  | { kind: "wand"; effect: MixEffect; last: Point }
  | { kind: "move"; start: Point; paint: ImageData };

/** One undo step: the paint, and the background behind it. */
interface Snapshot {
  paint: ImageData;
  background: HTMLImageElement | null;
}

const HISTORY_STEPS = 12;
/** Rubber stamps are 32 px bitmaps, stamped at twice their size, as Kid Pix's middle size does. */
const STAMP_CELL = 32;
const STAMP_SIZE = 64;
const WAND_RADIUS = 22;

const scratch = (width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("No 2D context for the Kid Pix layer");
  return { canvas, ctx };
};

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
  private readonly patterns = new Map<number, CanvasPattern | null>();
  private backdrop: HTMLCanvasElement | null = null;
  private stroke: Stroke | null = null;
  private hue = 0;

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
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > HISTORY_STEPS) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  private snapshot(): Snapshot {
    return { paint: this.ctx.getImageData(0, 0, this.width, this.height), background: this.background };
  }

  undo() {
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
    return { color: this.color, pattern: (brush) => this.pattern(brush), fontFamily: this.options.fontFamily, random: Math.random };
  }

  /** A repeating fill cut from a brush's icon, without the icon's margin. */
  private pattern(brush: number) {
    const known = this.patterns.get(brush);
    if (known !== undefined) return known;
    const sheet = this.options.images.brushes;
    if (!sheet?.complete || !sheet.naturalWidth) return null;
    const { canvas, ctx } = scratch(38, 38);
    ctx.drawImage(sheet, brush * 48 + 5, 5, 38, 38, 0, 0, 38, 38);
    const pattern = this.ctx.createPattern(canvas, "repeat");
    this.patterns.set(brush, pattern);
    return pattern;
  }

  // ---- strokes -------------------------------------------------------------------------

  /** `nib` is the kind of pencil: 0 pencil, 1 chalk, 2 crayon, 3 marker. */
  pencilDown(at: Point, sizeIndex: number, nib = 0) {
    this.remember();
    this.stroke = { kind: "pencil", size: PENCIL_SIZES[sizeIndex] ?? PENCIL_SIZES[1], nib, last: at };
    this.audio.toolDown(TOOL_NUMBER.pencil + nib);
    this.move(at);
  }

  brushDown(at: Point, brush: number) {
    this.remember();
    this.stroke = { kind: "brush", brush, last: at, state: newStroke(at, this.hue) };
    this.audio.toolDown(brush);
    brushDown(this.ctx, brush, at, this.brushEnv());
    this.move(at);
  }

  eraserDown(at: Point, sizeIndex: number) {
    this.remember();
    this.stroke = { kind: "eraser", size: ERASER_SIZES[sizeIndex] ?? ERASER_SIZES[1], last: at };
    this.move(at);
  }

  wandDown(at: Point, wand: number) {
    this.remember();
    this.stroke = { kind: "wand", effect: WAND_EFFECTS[wand] ?? "blur", last: { x: at.x - WAND_RADIUS, y: at.y } };
    this.audio.toolDown(TOOL_NUMBER.firstWand + wand);
    this.move(at);
  }

  /** The Moving Van picks up all the paint; the drawing under it stays put. */
  moveDown(at: Point) {
    this.remember();
    this.stroke = { kind: "move", start: at, paint: this.ctx.getImageData(0, 0, this.width, this.height) };
    this.audio.play("w7429");
  }

  move(to: Point) {
    const stroke = this.stroke;
    if (!stroke) return;
    const ctx = this.ctx;
    if (stroke.kind === "move") {
      ctx.clearRect(0, 0, this.width, this.height);
      ctx.putImageData(stroke.paint, Math.round(to.x - stroke.start.x), Math.round(to.y - stroke.start.y));
      return;
    }
    if (stroke.kind === "pencil") {
      this.pencilSegment(stroke.last, to, stroke.size, stroke.nib);
    } else if (stroke.kind === "brush") {
      brushSegment(ctx, stroke.brush, stroke.last, to, stroke.state, this.brushEnv());
      this.hue = stroke.state.hue;
    } else if (stroke.kind === "eraser") {
      const steps = Math.max(1, Math.ceil(Math.hypot(to.x - stroke.last.x, to.y - stroke.last.y) / 4));
      for (let i = 0; i <= steps; i++) {
        const x = stroke.last.x + ((to.x - stroke.last.x) * i) / steps;
        const y = stroke.last.y + ((to.y - stroke.last.y) * i) / steps;
        ctx.clearRect(x - stroke.size / 2, y - stroke.size / 2, stroke.size, stroke.size);
      }
    } else {
      // A wand works where it has not just been, or one spot would be mixed many times over.
      if (Math.hypot(to.x - stroke.last.x, to.y - stroke.last.y) < WAND_RADIUS / 2) return;
      this.mixRegion(
        { x: Math.floor(to.x - WAND_RADIUS), y: Math.floor(to.y - WAND_RADIUS), width: WAND_RADIUS * 2, height: WAND_RADIUS * 2 },
        stroke.effect,
        true,
      );
    }
    stroke.last = to;
    this.audio.toolMove();
  }

  private pencilSegment(from: Point, to: Point, size: number, nib: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = this.color;
    ctx.fillStyle = this.color;
    ctx.lineWidth = size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (nib === 1 || nib === 2) {
      // Chalk is dusty and crayon waxy: grains along the line, the crayon's packed closer.
      const width = size * (nib === 1 ? 2.2 : 1.6);
      const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 2));
      const grains = Math.ceil(width * (nib === 1 ? 0.6 : 1.4));
      ctx.globalAlpha = nib === 1 ? 0.55 : 0.8;
      for (let step = 0; step <= steps; step++) {
        const x = from.x + ((to.x - from.x) * step) / steps;
        const y = from.y + ((to.y - from.y) * step) / steps;
        for (let grain = 0; grain < grains; grain++) {
          ctx.fillRect(x + (Math.random() - 0.5) * width, y + (Math.random() - 0.5) * width, 1.5, 1.5);
        }
      }
    } else {
      if (nib === 3) {
        // A marker is broad, flat-tipped and a little see-through.
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = size * 2.5;
        ctx.lineCap = "butt";
      }
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  up() {
    const stroke = this.stroke;
    this.stroke = null;
    if (!stroke) return;
    if (stroke.kind === "move") this.audio.play("w7430");
    else this.audio.toolUp();
  }

  // ---- one-shot tools ------------------------------------------------------------------

  /** Paint Can: option 0 is the current color, then the patterns, then the gradients. */
  fill(at: Point, option: number, patternCount: number) {
    const { fills, gradients } = this.options.images;
    const source = scratch(this.width, this.height);
    const picture = this.composite().ctx.getImageData(0, 0, this.width, this.height);
    const { mask, box } = floodMask(picture.data, this.width, this.height, at.x, at.y);
    if (option === 0) {
      source.ctx.fillStyle = this.color;
      source.ctx.fillRect(box.x, box.y, box.width, box.height);
    } else if (option <= patternCount) {
      if (!fills?.complete || !fills.naturalWidth) return;
      // A pixel in from each edge: neighbors in the sheet bleed into a tile's rim.
      const tile = scratch(158, 158);
      tile.ctx.drawImage(fills, ((option - 1) % 7) * 160 + 1, Math.floor((option - 1) / 7) * 160 + 1, 158, 158, 0, 0, 158, 158);
      const pattern = source.ctx.createPattern(tile.canvas, "repeat");
      if (!pattern) return;
      source.ctx.fillStyle = pattern;
      source.ctx.fillRect(box.x, box.y, box.width, box.height);
    } else {
      if (!gradients?.complete || !gradients.naturalWidth) return;
      source.ctx.drawImage(gradients, (option - patternCount - 1) * 48 + 1, 1, 46, 46, box.x, box.y, box.width, box.height);
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
    this.audio.toolOnce(option === 0 ? TOOL_NUMBER.fillSolid : option <= patternCount ? TOOL_NUMBER.fillPattern : TOOL_NUMBER.fillGradient);
  }

  /** A whole-picture mixer: the result covers the drawing under it. */
  mix(mixer: number) {
    this.remember();
    this.mixRegion({ x: 0, y: 0, width: this.width, height: this.height }, MIXER_EFFECTS[mixer] ?? "invert", false);
    this.audio.toolOnce(TOOL_NUMBER.firstMixer + mixer);
  }

  private mixRegion(box: Box, effect: MixEffect, round: boolean) {
    const { canvas, ctx } = this.composite(box);
    const pixels = ctx.getImageData(0, 0, box.width, box.height);
    mixPixels(pixels.data, box.width, box.height, effect, rgb(this.color));
    ctx.putImageData(pixels, 0, 0);
    this.ctx.save();
    if (round) {
      this.ctx.beginPath();
      this.ctx.arc(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, 0, Math.PI * 2);
      this.ctx.clip();
    }
    this.ctx.drawImage(canvas, box.x, box.y);
    this.ctx.restore();
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
  sticker(at: Point, picture: SwfPicture) {
    this.remember();
    this.ctx.save();
    this.ctx.translate(Math.round(at.x - picture.width / 2), Math.round(at.y - picture.height / 2));
    picture.draw(this.ctx);
    this.ctx.restore();
    this.audio.play("misc31501");
  }

  /** Sets typed text on the paint, its middle line at `at`. */
  text(at: Point, value: string, family: string) {
    if (!value) return;
    this.remember();
    this.ctx.save();
    this.ctx.font = `${TEXT_SIZE}px ${family}`;
    this.ctx.fillStyle = this.color;
    this.ctx.textBaseline = "middle";
    this.ctx.fillText(value, at.x, at.y);
    this.ctx.restore();
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
