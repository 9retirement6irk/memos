/** Pixel work for the Kid Pix layer, on plain RGBA arrays so it runs and tests without a canvas. */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The connected area around (startX, startY) whose color is within `tolerance` of the start
 * pixel (summed over the four channels): the area a Paint Can fills. Returns a mask with 1 for
 * each pixel inside and the box around them.
 */
export const floodMask = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  tolerance = 90,
): { mask: Uint8Array; box: Box } => {
  const sx = Math.max(0, Math.min(width - 1, Math.floor(startX)));
  const sy = Math.max(0, Math.min(height - 1, Math.floor(startY)));
  const start = (sy * width + sx) * 4;
  const [r0, g0, b0, a0] = [data[start], data[start + 1], data[start + 2], data[start + 3]];
  const mask = new Uint8Array(width * height);
  const matches = (index: number) => {
    if (mask[index]) return false;
    const j = index * 4;
    return Math.abs(data[j] - r0) + Math.abs(data[j + 1] - g0) + Math.abs(data[j + 2] - b0) + Math.abs(data[j + 3] - a0) <= tolerance;
  };
  // Scanline fill: one stack entry per run, not per pixel.
  const stack = [sx, sy];
  let [minX, minY, maxX, maxY] = [width, height, 0, 0];
  while (stack.length) {
    const y = stack.pop() as number;
    let x = stack.pop() as number;
    while (x >= 0 && matches(y * width + x)) x--;
    x++;
    let above = false;
    let below = false;
    while (x < width && matches(y * width + x)) {
      mask[y * width + x] = 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (y > 0) {
        const open = matches((y - 1) * width + x);
        if (open && !above) stack.push(x, y - 1);
        above = open;
      }
      if (y < height - 1) {
        const open = matches((y + 1) * width + x);
        if (open && !below) stack.push(x, y + 1);
        below = open;
      }
      x++;
    }
  }
  return { mask, box: { x: minX, y: minY, width: Math.max(1, maxX - minX + 1), height: Math.max(1, maxY - minY + 1) } };
};

/** The box around every pixel that is not fully transparent, or null for an empty layer. */
export const paintBounds = (data: Uint8ClampedArray, width: number, height: number): Box | null => {
  let [minX, minY, maxX, maxY] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
};

/** Cuts a box into a grid of tiles no larger than `maxSide` on either side. */
export const planTiles = (box: Box, maxSide: number): Box[] => {
  const side = Math.max(1, Math.floor(maxSide));
  const columns = Math.ceil(box.width / side);
  const rows = Math.ceil(box.height / side);
  const tileWidth = Math.ceil(box.width / columns);
  const tileHeight = Math.ceil(box.height / rows);
  const tiles: Box[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = box.x + column * tileWidth;
      const y = box.y + row * tileHeight;
      tiles.push({ x, y, width: Math.min(tileWidth, box.x + box.width - x), height: Math.min(tileHeight, box.y + box.height - y) });
    }
  }
  return tiles;
};

/** The effects behind the Electric Mixer and its wands; each Kid Pix mixer maps to the nearest one. */
export type MixEffect =
  | "invert"
  | "grayscale"
  | "sepia"
  | "lighten"
  | "posterize"
  | "solarize"
  | "hue"
  | "nuclear"
  | "colorize"
  | "emboss"
  | "edge"
  | "blur"
  | "mosaic"
  /** The Smear wand, which drags the picture along and so is done by the engine, not here. */
  | "smear"
  | "flip"
  | "kaleidoscope"
  | "shear"
  | "ripple"
  | "wave"
  | "whirl"
  | "pinch"
  | "bulge"
  | "pointilize"
  | "bubbles"
  | "burlap"
  | "pulse";

const clampIndex = (value: number, max: number) => Math.max(0, Math.min(max, Math.round(value)));

/** Turns a pixel's hue by `degrees`, keeping how bright and how strong the color is. */
const rotateHue = (data: Uint8ClampedArray, i: number, degrees: number) => {
  const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return;
  const span = max - min;
  const hue = ((max === r ? ((g - b) / span) % 6 : max === g ? (b - r) / span + 2 : (r - g) / span + 4) * 60 + degrees + 720) % 360;
  // Back from hue: each channel is `min` plus a share of the span.
  const share = (offset: number) => {
    const k = (offset + hue / 60) % 6;
    return max - span * Math.max(0, Math.min(k, 4 - k, 1));
  };
  data[i] = share(5);
  data[i + 1] = share(3);
  data[i + 2] = share(1);
};

/** Kid Pix's sepia: this tan, as bright as the pixel's strongest channel. */
const SEPIA = [255, 189, 132] as const;

/**
 * Applies a mixer effect in place. The pixels must be opaque (the paper and the drawing under
 * the paint are already in them). `tint` is the current color, for Colorize; `random` is
 * injectable for tests.
 *
 * The whole-picture effects follow what Kid Pix's Mega-mixers do to a test picture: the color
 * ones to the exact value, the bending ones by eye. Kid Pix measures brightness by a pixel's
 * strongest channel, so pure green counts as bright as white.
 */
export const mixPixels = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  effect: MixEffect,
  tint: readonly [number, number, number] = [255, 0, 128],
  random: () => number = Math.random,
): void => {
  const source = new Uint8ClampedArray(data);
  const copy = (to: number, from: number) => {
    data[to] = source[from];
    data[to + 1] = source[from + 1];
    data[to + 2] = source[from + 2];
  };
  const perPixel = (change: (i: number) => void) => {
    for (let i = 0; i < data.length; i += 4) change(i);
  };
  // Geometric effects pull each pixel from somewhere else in the picture.
  const displace = (from: (x: number, y: number) => [number, number]) => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const [fx, fy] = from(x, y);
        copy((y * width + x) * 4, (clampIndex(fy, height - 1) * width + clampIndex(fx, width - 1)) * 4);
      }
    }
  };
  const radial = (bend: (distance: number, angle: number) => [number, number]) => {
    const [cx, cy] = [width / 2, height / 2];
    const reach = Math.hypot(cx, cy);
    displace((x, y) => {
      const [d, a] = bend(Math.hypot(x - cx, y - cy) / reach, Math.atan2(y - cy, x - cx));
      return [cx + Math.cos(a) * d * reach, cy + Math.sin(a) * d * reach];
    });
  };
  const luma = (i: number) => source[i] * 0.299 + source[i + 1] * 0.587 + source[i + 2] * 0.114;
  const brightest = (i: number) => Math.max(source[i], source[i + 1], source[i + 2]);

  switch (effect) {
    case "invert":
      perPixel((i) => {
        for (let c = 0; c < 3; c++) data[i + c] = 255 - data[i + c];
      });
      break;
    case "grayscale":
      perPixel((i) => {
        data[i] = data[i + 1] = data[i + 2] = brightest(i);
      });
      break;
    case "sepia":
      perPixel((i) => {
        const value = brightest(i) / 255;
        for (let c = 0; c < 3; c++) data[i + c] = SEPIA[c] * value;
      });
      break;
    case "lighten":
      // One step of the original's 15-bit color.
      perPixel((i) => {
        for (let c = 0; c < 3; c++) data[i + c] = data[i + c] + 8;
      });
      break;
    case "posterize":
      perPixel((i) => {
        for (let c = 0; c < 3; c++) data[i + c] = data[i + c] > 170 ? 255 : data[i + c] > 85 ? 128 : 0;
      });
      break;
    case "solarize":
      // A bright pixel turns as dark as it was bright: white and pure colors go black.
      perPixel((i) => {
        const value = brightest(i);
        if (value < 128) return;
        for (let c = 0; c < 3; c++) data[i + c] = (data[i + c] * (255 - value)) / value;
      });
      break;
    case "hue":
      perPixel((i) => rotateHue(data, i, 30));
      break;
    case "nuclear":
      perPixel((i) => rotateHue(data, i, 180));
      break;
    case "colorize":
      perPixel((i) => {
        const value = brightest(i) / 255;
        for (let c = 0; c < 3; c++) data[i + c] = tint[c] * value;
      });
      break;
    case "emboss":
    case "edge":
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const here = (y * width + x) * 4;
          const there = (Math.max(0, y - 1) * width + Math.max(0, x - 1)) * 4;
          // Kid Pix embosses by brightness, so an edge between two bright colors does not show.
          const difference = effect === "emboss" ? brightest(here) - brightest(there) : luma(here) - luma(there);
          data[here] = data[here + 1] = data[here + 2] = effect === "emboss" ? 123 + difference : 255 - Math.abs(difference) * 6;
        }
      }
      break;
    case "blur": {
      const reach = 3;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const sum = [0, 0, 0];
          let count = 0;
          for (let dy = -reach; dy <= reach; dy += 3) {
            for (let dx = -reach; dx <= reach; dx += 3) {
              const j = (clampIndex(y + dy, height - 1) * width + clampIndex(x + dx, width - 1)) * 4;
              for (let c = 0; c < 3; c++) sum[c] += source[j + c];
              count++;
            }
          }
          const here = (y * width + x) * 4;
          for (let c = 0; c < 3; c++) data[here + c] = sum[c] / count;
        }
      }
      break;
    }
    case "mosaic":
      displace((x, y) => [Math.floor(x / 12) * 12 + 6, Math.floor(y / 12) * 12 + 6]);
      break;
    case "pointilize":
      // Static, with a speck of the picture's negative here and there.
      perPixel((i) => {
        if (random() < 0.2) {
          for (let c = 0; c < 3; c++) data[i + c] = 255 - source[i + c];
        } else {
          data[i] = data[i + 1] = data[i + 2] = random() * 190;
        }
      });
      break;
    case "flip":
      displace((x, y) => [width - 1 - x, y]);
      break;
    case "kaleidoscope": {
      // Eight wedges about the middle, each a mirror of its neighbor.
      const [cx, cy] = [width / 2, height / 2];
      const wedge = Math.PI / 4;
      displace((x, y) => {
        const distance = Math.hypot(x - cx, y - cy);
        const turn = ((Math.atan2(y - cy, x - cx) % (wedge * 2)) + wedge * 2) % (wedge * 2);
        const angle = turn > wedge ? wedge * 2 - turn : turn;
        return [cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance];
      });
      break;
    }
    case "shear":
      displace((x, y) => [x + (y - height / 2) * 0.04, y]);
      break;
    case "ripple":
      displace((x, y) => [x + Math.sin(y / 10) * 2.5, y + Math.sin(x / 10) * 2.5]);
      break;
    case "wave":
      displace((x, y) => [x + Math.sin(y / 40) * 14, y + Math.sin(x / 40) * 14]);
      break;
    case "bubbles":
      displace((x, y) => [x + Math.sin(y / 2) * 1.5, y + Math.sin(x / 2) * 1.5]);
      break;
    case "burlap":
      // Every third row pair slips sideways, the next one back.
      displace((x, y) => [x + (Math.floor(y / 3) % 2 ? 3 : -3), y]);
      break;
    case "pulse": {
      // Two bands across the picture shiver, row against row.
      const band = height * 0.06;
      displace((x, y) => {
        const inBand = Math.abs(y - height * 0.4) < band || Math.abs(y - height * 0.62) < band;
        return [inBand ? x + (y % 2 ? 5 : -5) : x, y];
      });
      break;
    }
    case "whirl":
      radial((d, a) => [d, a + (1 - Math.min(1, d * 1.6)) * 1.1]);
      break;
    case "pinch":
      radial((d, a) => [d ** 0.6, a]);
      break;
    case "bulge":
      radial((d, a) => [d ** 1.6, a]);
      break;
  }
};
