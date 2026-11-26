/**
 * The paper's tooth GZreader's pencil draws on (its `Sketch.grain`): a 256 x 256 patch of
 * numbers from 0 to 1 that repeats over the page, the same for the same page pixel every
 * time. The pencil marks a pixel when the tooth there is under how hard it was pressed, so
 * a light line is sparse specks and a pressed one is nearly solid.
 */
export const GRAIN_SIDE = 256;

const grainHash = (a: number, b: number): number => {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263);
  h ^= h >>> 15;
  h = ((h & 0xffff) * 40503 + (h >>> 16) * 30011) | 0;
  h ^= h >>> 13;
  return (h & 0xffff) / 65536;
};

let patch: Float32Array | undefined;

/** The patch, row by row. */
export const grainPatch = (): Float32Array => {
  if (!patch) {
    patch = new Float32Array(GRAIN_SIDE * GRAIN_SIDE);
    for (let y = 0; y < GRAIN_SIDE; y++) {
      for (let x = 0; x < GRAIN_SIDE; x++) {
        patch[y * GRAIN_SIDE + x] = 0.65 * grainHash(x, y) + 0.35 * grainHash(x >> 1, (y >> 1) + 7919);
      }
    }
  }
  return patch;
};

/** The tooth at page pixel (x, y). */
export const grain = (x: number, y: number): number => grainPatch()[(y & (GRAIN_SIDE - 1)) * GRAIN_SIDE + (x & (GRAIN_SIDE - 1))];

/** How finely a line's darkness is stepped: each step is one tile of specks. */
export const GRAIN_LEVELS = 32;

/** The step for a share of the paper covered, 0 to 1. */
export const grainLevel = (cover: number): number => Math.max(0, Math.min(GRAIN_LEVELS, Math.round(cover * GRAIN_LEVELS)));

/**
 * The patch as RGBA pixels for one step: `rgb` where the tooth is under the step's share,
 * clear elsewhere. A darker step marks every pixel a lighter one does.
 */
export const grainTile = (level: number, rgb: readonly [number, number, number]): Uint8ClampedArray => {
  const source = grainPatch();
  const threshold = level / GRAIN_LEVELS;
  const pixels = new Uint8ClampedArray(source.length * 4);
  for (let i = 0; i < source.length; i++) {
    if (source[i] >= threshold) continue;
    pixels[i * 4] = rgb[0];
    pixels[i * 4 + 1] = rgb[1];
    pixels[i * 4 + 2] = rgb[2];
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
};
