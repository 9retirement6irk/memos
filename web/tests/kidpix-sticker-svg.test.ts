// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { KIDPIX_STICKERS } from "@/components/DrawingSheet/kidpix/library";
import { readStickers } from "@/components/DrawingSheet/kidpix/swf";

// public/kidpix/sticker-svg: the stickers as gzipped SVG pictures for apps that can't read Flash
// (GZreader's drawing screen), made by scripts/render-kidpix-stickers.mjs from swf.ts's `svg()`.
const dir = resolve(__dirname, "../public/kidpix/sticker-svg");
const movies = (i: number) =>
  readStickers(
    readFileSync(resolve(__dirname, "../public/kidpix/stickers", `${KIDPIX_STICKERS[i].slug}.bin`)),
    KIDPIX_STICKERS[i].items.map(([, length]) => length),
  );

interface Index {
  version: number;
  categories: { slug: string; name: string; items: { name: string; file: string; width: number; height: number }[] }[];
}

describe("Kid Pix stickers as SVG", () => {
  const index = JSON.parse(readFileSync(resolve(dir, "index.json"), "utf8")) as Index;

  it("lists every category and sticker of the library, in its order", () => {
    expect(index.version).toBe(1);
    expect(index.categories.map((c) => c.slug)).toEqual(KIDPIX_STICKERS.map((c) => c.slug));
    index.categories.forEach((cat, i) => {
      expect(cat.name).toBe(KIDPIX_STICKERS[i].name);
      expect(cat.items.map((it) => it.name)).toEqual(KIDPIX_STICKERS[i].items.map(([name]) => name));
      cat.items.forEach((it, n) => expect(it.file).toBe(`${cat.slug}/${n}.svgz`));
    });
  });

  it("has each sticker as what swf.ts's svg() writes, gzipped, at its frame's size", () => {
    index.categories.forEach((cat, i) => {
      const pictures = movies(i);
      cat.items.forEach((it, n) => {
        const path = resolve(dir, it.file);
        expect(existsSync(path), it.file).toBe(true);
        const svg = gunzipSync(readFileSync(path)).toString("utf8");
        expect(svg).toBe(`${pictures[n].svg()}\n`);
        expect(it.width).toBe(Math.max(1, Math.round(pictures[n].width)));
        expect(it.height).toBe(Math.max(1, Math.round(pictures[n].height)));
      });
    });
  }, 60000);

  it("writes SVG a browser reads: the frame's size, gradients defined once and used, paths that parse", () => {
    const pictures = movies(0);
    const doc = new DOMParser().parseFromString(pictures[5].svg(), "image/svg+xml");
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    const root = doc.documentElement;
    expect(root.getAttribute("width")).toBe(String(Math.round(pictures[5].width * 100) / 100));
    expect(root.getAttribute("viewBox")).toBe(`0 0 ${root.getAttribute("width")} ${root.getAttribute("height")}`);
    // every gradient a fill names is defined (none of Kid Pix's stickers has one today)
    for (const [i] of KIDPIX_STICKERS.entries()) {
      for (const p of movies(i)) {
        const text = p.svg();
        for (const [, id] of text.matchAll(/url\(#(g\d+)\)/g)) {
          expect(text).toContain(`id="${id}"`);
        }
        // path data: commands and numbers only ("2.8.3" is 2.8 then .3, as SVG reads it)
        for (const [, d] of text.matchAll(/ d="([^"]*)"/g)) {
          expect(d).toMatch(/^M[-.\d]/);
          expect(d).toMatch(/^[Mlqz\d.\- ]+$/);
        }
      }
    }
  }, 60000);
});
