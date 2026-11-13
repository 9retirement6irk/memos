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
  | "speckle"
  | "flip"
  | "kaleidoscope"
  | "shear"
  | "ripple"
  | "wave"
  | "whirl"
  | "pinch"
  | "bulge"
  | "zoom";

const clampIndex = (value: number, max: number) => Math.max(0, Math.min(max, Math.round(value)));

const rotateHue = (data: Uint8ClampedArray, i: number, degrees: number, saturation = 1) => {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle) * saturation;
  const sin = Math.sin(angle) * saturation;
  const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
  // Rotation around the gray axis, in the YIQ sense.
  data[i] = r * (0.299 + 0.701 * cos + 0.168 * sin) + g * (0.587 - 0.587 * cos + 0.33 * sin) + b * (0.114 - 0.114 * cos - 0.497 * sin);
  data[i + 1] = r * (0.299 - 0.299 * cos - 0.328 * sin) + g * (0.587 + 0.413 * cos + 0.035 * sin) + b * (0.114 - 0.114 * cos + 0.292 * sin);
  data[i + 2] = r * (0.299 - 0.3 * cos + 1.25 * sin) + g * (0.587 - 0.588 * cos - 1.05 * sin) + b * (0.114 + 0.886 * cos - 0.203 * sin);
};

/**
 * Applies a mixer effect in place. The pixels must be opaque (the paper and the drawing under
 * the paint are already in them). `tint` is the current color, for Colorize; `random` is
 * injectable for tests.
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

  switch (effect) {
    case "invert":
      perPixel((i) => {
        for (let c = 0; c < 3; c++) data[i + c] = 255 - data[i + c];
      });
      break;
    case "grayscale":
      perPixel((i) => {
        data[i] = data[i + 1] = data[i + 2] = luma(i);
      });
      break;
    case "sepia":
      perPixel((i) => {
        const l = luma(i);
        data[i] = l * 1.07 + 20;
        data[i + 1] = l * 0.9 + 8;
        data[i + 2] = l * 0.68;
      });
      break;
    case "lighten":
      perPixel((i) => {
        for (let c = 0; c < 3; c++) data[i + c] = data[i + c] + (255 - data[i + c]) * 0.45;
      });
      break;
    case "posterize":
      perPixel((i) => {
        for (let c = 0; c < 3; c++) data[i + c] = data[i + c] > 170 ? 255 : data[i + c] > 85 ? 128 : 0;
      });
      break;
    case "solarize":
      perPixel((i) => {
        for (let c = 0; c < 3; c++) data[i + c] = data[i + c] < 128 ? 255 - data[i + c] : data[i + c];
      });
      break;
    case "hue":
      perPixel((i) => rotateHue(data, i, 120));
      break;
    case "nuclear":
      perPixel((i) => rotateHue(data, i, 200, 2.4));
      break;
    case "colorize":
      perPixel((i) => {
        const l = luma(i) / 255;
        for (let c = 0; c < 3; c++) data[i + c] = l < 0.5 ? tint[c] * l * 2 : tint[c] + (255 - tint[c]) * (l * 2 - 1);
      });
      break;
    case "emboss":
    case "edge":
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const here = (y * width + x) * 4;
          const there = (Math.max(0, y - 1) * width + Math.max(0, x - 1)) * 4;
          const difference = luma(here) - luma(there);
          data[here] = data[here + 1] = data[here + 2] = effect === "emboss" ? 128 + difference * 2 : 255 - Math.abs(difference) * 6;
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
    case "speckle":
      displace((x, y) => [x + (random() - 0.5) * 14, y + (random() - 0.5) * 14]);
      break;
    case "flip":
      displace((x, y) => [x, height - 1 - y]);
      break;
    case "kaleidoscope":
      displace((x, y) => [x < width / 2 ? x : width - 1 - x, y < height / 2 ? y : height - 1 - y]);
      break;
    case "shear":
      displace((x, y) => [x + (y - height / 2) * 0.35, y]);
      break;
    case "ripple":
      displace((x, y) => [x + Math.sin(y / 9) * 7, y + Math.sin(x / 9) * 7]);
      break;
    case "wave":
      displace((x, y) => [x, y + Math.sin(x / 28) * 22]);
      break;
    case "whirl":
      radial((d, a) => [d, a + (1 - Math.min(1, d * 1.6)) * 2.2]);
      break;
    case "pinch":
      radial((d, a) => [d ** 0.6, a]);
      break;
    case "bulge":
      radial((d, a) => [d ** 1.6, a]);
      break;
    case "zoom":
      radial((d, a) => [d * (0.7 + 0.3 * Math.cos(d * 22)), a]);
      break;
  }
};
