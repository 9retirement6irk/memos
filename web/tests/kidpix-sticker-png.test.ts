import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { KIDPIX_STICKERS } from "@/components/DrawingSheet/kidpix/library";
import { readStickers } from "@/components/DrawingSheet/kidpix/swf";

// public/kidpix/sticker-png: the stickers as PNG pictures for apps that can't read Flash
// (GZreader's drawing screen), made by scripts/render-kidpix-stickers.mjs.
const dir = resolve(__dirname, "../public/kidpix/sticker-png");

interface Index {
  version: number;
  scale: number;
  categories: { slug: string; name: string; items: { name: string; file: string; width: number; height: number }[] }[];
}

describe("Kid Pix stickers as PNG", () => {
  const index = JSON.parse(readFileSync(resolve(dir, "index.json"), "utf8")) as Index;

  it("lists every category and sticker of the library, in its order", () => {
    expect(index.version).toBe(1);
    expect(index.scale).toBe(2);
    expect(index.categories.map((c) => c.slug)).toEqual(KIDPIX_STICKERS.map((c) => c.slug));
    index.categories.forEach((cat, i) => {
      expect(cat.name).toBe(KIDPIX_STICKERS[i].name);
      expect(cat.items.map((it) => it.name)).toEqual(KIDPIX_STICKERS[i].items.map(([name]) => name));
      cat.items.forEach((it, n) => expect(it.file).toBe(`${cat.slug}/${n}.png`));
    });
  });

  it("has each sticker's picture: an indexed PNG at twice the movie's frame", () => {
    for (const [i, cat] of index.categories.entries()) {
      const movies = readStickers(
        readFileSync(resolve(__dirname, "../public/kidpix/stickers", `${cat.slug}.bin`)),
        KIDPIX_STICKERS[i].items.map(([, length]) => length),
      );
      cat.items.forEach((it, n) => {
        const path = resolve(dir, it.file);
        expect(existsSync(path), it.file).toBe(true);
        const png = readFileSync(path);
        expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
        expect(png.readUInt32BE(16)).toBe(it.width * 2);
        expect(png.readUInt32BE(20)).toBe(it.height * 2);
        expect(png[25], `${it.file}: indexed colour`).toBe(3);
        expect(it.width).toBe(Math.max(1, Math.round(movies[n].width)));
        expect(it.height).toBe(Math.max(1, Math.round(movies[n].height)));
      });
    }
  });
});
