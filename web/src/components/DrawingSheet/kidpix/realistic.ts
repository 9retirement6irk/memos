import type { Point } from "./brushes";
import { REALISTIC_BRUSHES } from "./tips";

/**
 * Kid Pix's Realistic brushes. Each one presses a tip bitmap from Brushes.MHK along the stroke:
 * how far apart, how far off the line, how strongly and with what shadow come from its section
 * of KP.cfg. What each setting does was worked out by drawing one tap and one line with every
 * brush in the original and fitting this model to the pixels (see README.md).
 */

/** A press may land up to this many times the cfg's `oscillation` from the stroke (fitted). */
const WANDER_REACH = 1.6;
/** A spattering brush picks among this many ready-made scatterings of its tip. */
const SPATTERINGS = 8;
/** Stamp sets kept ready, one per brush, size and color in use. */
const KEPT = 12;

interface Stamps {
  width: number;
  height: number;
  marks: readonly HTMLCanvasElement[];
  shadow: HTMLCanvasElement | null;
  shadowOffset: number;
}

const canvasOf = (width: number, height: number, alpha: (at: number) => number, [red, green, blue]: readonly [number, number, number]) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D context for a brush tip");
  const image = ctx.createImageData(width, height);
  for (let at = 0; at < width * height; at++) image.data.set([red, green, blue, alpha(at)], at * 4);
  ctx.putImageData(image, 0, 0);
  return canvas;
};

const rgb = (hex: string): [number, number, number] => {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

export class RealisticBrushes {
  private readonly kept = new Map<string, Stamps>();
  private sheet: ImageData | null = null;

  /** `tips` is assets/brush-tips.png, which may still be loading. */
  constructor(
    private readonly tips: () => HTMLImageElement | undefined,
    private readonly random: () => number = Math.random,
  ) {}

  private pixels() {
    if (this.sheet) return this.sheet;
    const image = this.tips();
    if (!image?.complete || !image.naturalWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0);
    this.sheet = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return this.sheet;
  }

  private stamps(brush: number, size: number, color: string): Stamps | null {
    const key = `${brush}:${size}:${color}`;
    const known = this.kept.get(key);
    if (known) return known;
    const sheet = this.pixels();
    const settings = REALISTIC_BRUSHES[brush];
    if (!sheet || !settings) return null;
    const [left, top, width, height] = settings.tips[size] ?? settings.tips[1];
    const tip = (at: number) => sheet.data[((top + Math.floor(at / width)) * sheet.width + left + (at % width)) * 4 + 3];
    // A spattering brush keeps a pixel at full strength or drops it; the others thin every pixel.
    const strength = settings.spatter ? 1 : 1 / settings.density;
    const keep = settings.spatter ? 1 / (settings.spatter * settings.density) : 1;
    const marks = Array.from({ length: keep < 1 ? SPATTERINGS : 1 }, () =>
      canvasOf(width, height, (at) => (this.random() < keep ? tip(at) * strength : 0), rgb(color)),
    );
    const [shadowOffset, shadowBias] = settings.shadow;
    const shadow = shadowOffset && shadowBias ? canvasOf(width, height, (at) => tip(at) / shadowBias, [0, 0, 0]) : null;
    const stamps = { width, height, marks, shadow, shadowOffset };
    if (this.kept.size >= KEPT) this.kept.delete(this.kept.keys().next().value as string);
    this.kept.set(key, stamps);
    return stamps;
  }

  /**
   * Presses the brush along the line from `from` to `to`. `carry` is how far the stroke has run
   * since its last press, so presses stay evenly spaced from one segment to the next. Returns
   * false while the tips are still loading.
   */
  segment(ctx: CanvasRenderingContext2D, brush: number, size: number, color: string, from: Point, to: Point, carry: { run: number }) {
    const stamps = this.stamps(brush, size, color);
    const settings = REALISTIC_BRUSHES[brush];
    if (!stamps || !settings) return false;
    const reach = settings.wander * WANDER_REACH;
    const press = (x: number, y: number) => {
      let [px, py] = [x, y];
      if (reach) {
        const angle = this.random() * Math.PI * 2;
        const far = reach * Math.sqrt(this.random());
        px += Math.cos(angle) * far;
        py += Math.sin(angle) * far;
      }
      const left = Math.round(px - stamps.width / 2);
      const top = Math.round(py - stamps.height / 2);
      if (stamps.shadow) ctx.drawImage(stamps.shadow, left + stamps.shadowOffset, top + stamps.shadowOffset);
      ctx.drawImage(stamps.marks[Math.floor(this.random() * stamps.marks.length)], left, top);
    };
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (carry.run === 0 && length === 0) press(from.x, from.y);
    let at = carry.run === 0 ? 0 : settings.spacing - carry.run;
    for (; at <= length && length > 0; at += settings.spacing) {
      press(from.x + ((to.x - from.x) * at) / length, from.y + ((to.y - from.y) * at) / length);
    }
    if (length > 0 || carry.run === 0) carry.run = Math.max(1e-6, length === 0 ? 0 : settings.spacing - (at - length));
    return true;
  }
}
