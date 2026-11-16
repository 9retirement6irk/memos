/** A rubber stamp being edited: `size` px a side, four bytes a pixel, as a canvas holds them. */
export type StampPixels = Uint8ClampedArray;
export type StampColor = readonly [number, number, number, number];

/** Rubber stamps are 32 px bitmaps; the editor shows one eight times its size. */
export const STAMP_PX = 32;
export const STAMP_EDITOR_ZOOM = 8;

const same = (pixels: StampPixels, at: number, color: StampColor) =>
  pixels[at] === color[0] && pixels[at + 1] === color[1] && pixels[at + 2] === color[2] && pixels[at + 3] === color[3];

/** The Pencil: one pixel takes the color. */
export const setStampPixel = (pixels: StampPixels, size: number, x: number, y: number, color: StampColor) => {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  pixels.set(color, (y * size + x) * 4);
};

/** The Fill Bucket: the pixel and every one like it that it touches, side to side or up and down. */
export const fillStamp = (pixels: StampPixels, size: number, x: number, y: number, color: StampColor) => {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const start = (y * size + x) * 4;
  const from: StampColor = [pixels[start], pixels[start + 1], pixels[start + 2], pixels[start + 3]];
  if (same(pixels, start, color)) return;
  const waiting = [[x, y]];
  while (waiting.length > 0) {
    const [px, py] = waiting.pop() as [number, number];
    if (px < 0 || py < 0 || px >= size || py >= size) continue;
    const at = (py * size + px) * 4;
    if (!same(pixels, at, from)) continue;
    pixels.set(color, at);
    waiting.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
  }
};

/** Flip: left to right. */
export const flipStamp = (pixels: StampPixels, size: number): StampPixels => {
  const out = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) out.set(pixels.subarray((y * size + x) * 4, (y * size + x) * 4 + 4), (y * size + (size - 1 - x)) * 4);
  return out;
};

/** Rotate: a quarter turn clockwise a click. */
export const rotateStamp = (pixels: StampPixels, size: number): StampPixels => {
  const out = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) out.set(pixels.subarray((y * size + x) * 4, (y * size + x) * 4 + 4), (x * size + (size - 1 - y)) * 4);
  return out;
};
