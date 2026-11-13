import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { KIDPIX_BACKGROUNDS, KIDPIX_STAMPS, KIDPIX_STICKERS } from "@/components/DrawingSheet/kidpix/library";
import { KIDPIX_SPRAY_SETS } from "@/components/DrawingSheet/kidpix/spray";
import { readStickers } from "@/components/DrawingSheet/kidpix/swf";

const file = (path: string) => resolve(__dirname, "../public/kidpix", path);

/** A canvas context that only counts what is drawn on it. */
const recorder = () => {
  const calls: Record<string, number> = {};
  const gradient = { addColorStop: () => undefined };
  const ctx = new Proxy(
    {},
    {
      get: (_target, key: string) => {
        if (key === "createLinearGradient" || key === "createRadialGradient") return () => gradient;
        return () => {
          calls[key] = (calls[key] ?? 0) + 1;
        };
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
};

describe("Kid Pix library", () => {
  it("ships a file for every category it lists", () => {
    expect(KIDPIX_STICKERS).toHaveLength(42);
    expect(KIDPIX_BACKGROUNDS).toHaveLength(12);
    expect(KIDPIX_STAMPS).toHaveLength(20);
    for (const { slug } of KIDPIX_STICKERS) expect(existsSync(file(`stickers/${slug}.bin`)), slug).toBe(true);
    for (const { slug } of KIDPIX_STAMPS) expect(existsSync(file(`stamps/${slug}.png`)), slug).toBe(true);
    for (const { slug, items } of KIDPIX_BACKGROUNDS) {
      expect(existsSync(file(`backgrounds/${slug}.jpg`)), slug).toBe(true);
      items.forEach((_, index) => expect(existsSync(file(`backgrounds/${slug}/${index}.jpg`)), `${slug}/${index}`).toBe(true));
    }
  });

  it("reads every sticker in every category as a picture with shapes to draw", () => {
    let count = 0;
    for (const { slug, items } of KIDPIX_STICKERS) {
      const bytes = new Uint8Array(readFileSync(file(`stickers/${slug}.bin`)));
      expect(
        items.reduce((sum, [, length]) => sum + length, 0),
        slug,
      ).toBe(bytes.length);
      const pictures = readStickers(
        bytes,
        items.map(([, length]) => length),
      );
      for (const picture of pictures) {
        expect(picture.width).toBeGreaterThan(0);
        expect(picture.height).toBeGreaterThan(0);
        expect(picture.shapeCount).toBeGreaterThan(0);
      }
      count += pictures.length;
    }
    expect(count).toBe(935);
  });

  it("draws a sticker as filled outlines inside its frame", () => {
    const { slug, items } = KIDPIX_STICKERS[0];
    expect(items[0][0]).toBe("Armadillo");
    const [armadillo] = readStickers(
      new Uint8Array(readFileSync(file(`stickers/${slug}.bin`))),
      items.map(([, length]) => length),
    );
    const { ctx, calls } = recorder();
    armadillo.draw(ctx);
    expect(calls.fill).toBeGreaterThan(3);
    expect(calls.closePath).toBeGreaterThanOrEqual(calls.fill);
    expect(calls.save).toBe(calls.restore);
  });

  it("refuses a file that is not a Flash movie", () => {
    expect(() => readStickers(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), [9])).toThrow();
    vi.restoreAllMocks();
  });

  it("ships a sheet of pictures for every Spray Can set, and its clips for moving paint", () => {
    expect(KIDPIX_SPRAY_SETS.filter((set) => set.kind === "shapes")).toHaveLength(15);
    expect(KIDPIX_SPRAY_SETS.filter((set) => set.kind === "moving")).toHaveLength(20);
    for (const set of KIDPIX_SPRAY_SETS) {
      expect(existsSync(file(`spray/${set.file}.png`)), set.file).toBe(true);
      expect(set.frames.length, set.name).toBeGreaterThan(0);
      // The PNG header holds the sheet's size; every picture must lie inside it.
      const png = readFileSync(file(`spray/${set.file}.png`));
      const width = png.readUInt32BE(16);
      const height = png.readUInt32BE(20);
      // Moving paint says where each picture lands and which clip it plays; 3D shapes say neither.
      expect(Boolean(set.clips), set.name).toBe(set.kind === "moving");
      if (set.clips) expect(existsSync(file(`spray/${set.file}.m4a`)), set.file).toBe(true);
      for (const [x, y, w, h, , , clip] of set.frames) {
        expect(x + w, set.name).toBeLessThanOrEqual(width);
        expect(y + h, set.name).toBeLessThanOrEqual(height);
        if (set.clips) expect(clip, set.name).toBeLessThan(set.clips.length);
        else expect(clip, set.name).toBeUndefined();
      }
    }
  });
});
