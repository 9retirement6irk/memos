// Writes the Kid Pix stickers (public/kidpix/stickers/<slug>.bin: small Flash movies, see
// src/components/DrawingSheet/kidpix/swf.ts) as SVG pictures, for apps that can't read Flash:
// GZreader's drawing screen on a Kindle fetches them from this server.
//
//   node scripts/render-kidpix-stickers.mjs [--check] [--compare]
//
// Writes public/kidpix/sticker-svg/<slug>/<n>.svgz (n from 0, in the library's order): each
// sticker's shapes, gradients and outlines as swf.ts reads them (its `svg()`, what `draw()`
// paints), at the movie's frame size, on a clear ground, gzipped (an .svgz file: as plain SVG text
// the 935 stickers are 20 MB, gzipped 5 MB, about the size of the Flash files); and
// public/kidpix/sticker-svg/index.json:
//   { version, categories: [{ slug, name, items: [{ name, file, width, height }] }] }
// width and height are the frame's size in px.
// --check: fail if anything differs from what's there (each sticker compared unzipped).
// --compare: also draw each SVG and swf.ts's canvas drawing in headless Chromium (Playwright)
// and fail if more than 5% of a sticker's pixels differ (a pixel a pixel away counts as the same:
// anti-aliased edges fall a little differently). The most that differ, 4% of a flag, are the hairline
// seams the canvas leaves between two shapes that touch, which the SVG doesn't have.

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const KIDPIX = join(WEB, "src/components/DrawingSheet/kidpix");
const OUT = join(WEB, "public/kidpix/sticker-svg");
const check = process.argv.includes("--check");
const compare = process.argv.includes("--compare");

// library.ts and swf.ts as plain modules (they import nothing)
const load = async (file) => {
  const js = stripTypeScriptTypes(await readFile(join(KIDPIX, file), "utf8"), { mode: "transform" });
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
};
const { KIDPIX_STICKERS } = await load("library.ts");
const { readStickers } = await load("swf.ts");

const index = { version: 1, categories: [] };
const files = new Map(); // relative path → text
const movies = []; // { file, b64 } for --compare
for (const cat of KIDPIX_STICKERS) {
  const bytes = await readFile(join(WEB, "public/kidpix/stickers", `${cat.slug}.bin`));
  const pictures = readStickers(
    bytes,
    cat.items.map((it) => it[1]),
  );
  let offset = 0;
  const items = pictures.map((picture, n) => {
    const file = `${cat.slug}/${n}.svgz`;
    files.set(file, `${picture.svg()}\n`);
    movies.push({ file, b64: bytes.subarray(offset, offset + cat.items[n][1]).toString("base64") });
    offset += cat.items[n][1];
    return { name: cat.items[n][0], file, width: Math.max(1, Math.round(picture.width)), height: Math.max(1, Math.round(picture.height)) };
  });
  index.categories.push({ slug: cat.slug, name: cat.name, items });
}
files.set("index.json", `${JSON.stringify(index, null, 1)}\n`);

if (compare) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<!doctype html><title>stickers</title>");
  const swf = stripTypeScriptTypes(await readFile(join(KIDPIX, "swf.ts"), "utf8"), { mode: "transform" });
  await page.addScriptTag({ content: swf.replace(/^export const /gm, "window.") });
  let worst = 0;
  let worstFile = "";
  for (const { file, b64 } of movies) {
    const share = await page.evaluate(
      async ({ b64, svg }) => {
        const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const p = window.readSwfPicture(raw);
        const w = Math.max(1, Math.round(p.width)) * 2;
        const h = Math.max(1, Math.round(p.height)) * 2;
        const a = new OffscreenCanvas(w, h).getContext("2d");
        a.scale(2, 2);
        p.draw(a);
        const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        const img = new Image();
        img.src = url;
        await img.decode();
        const b = new OffscreenCanvas(w, h).getContext("2d");
        b.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        const pa = a.getImageData(0, 0, w, h).data;
        const pb = b.getImageData(0, 0, w, h).data;
        // a pixel of the SVG's matches when the canvas has a close one at most a pixel away
        // (thin outlines' anti-aliased edges fall a little differently)
        const near = (i, j) =>
          Math.max(
            Math.abs(pa[j] - pb[i]),
            Math.abs(pa[j + 1] - pb[i + 1]),
            Math.abs(pa[j + 2] - pb[i + 2]),
            Math.abs(pa[j + 3] - pb[i + 3]),
          ) <= 64;
        let off = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            let ok = false;
            for (let dy = -1; dy <= 1 && !ok; dy++) {
              for (let dx = -1; dx <= 1 && !ok; dx++) {
                const yy = y + dy;
                const xx = x + dx;
                if (yy >= 0 && yy < h && xx >= 0 && xx < w) ok = near(i, (yy * w + xx) * 4);
              }
            }
            if (!ok) off++;
          }
        }
        return off / (w * h);
      },
      { b64, svg: files.get(file) },
    );
    if (share > worst) {
      worst = share;
      worstFile = file;
    }
  }
  await browser.close();
  console.log(`compared with the canvas drawing: at most ${(worst * 100).toFixed(2)}% of pixels differ (${worstFile})`);
  if (worst > 0.05) process.exit(1);
}

const digest = (text) => createHash("sha256").update(text).digest("hex");
if (check) {
  let bad = 0;
  for (const [file, text] of files) {
    const raw = await readFile(join(OUT, file)).catch(() => null);
    const have = raw && (file.endsWith(".svgz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8"));
    if (have === null || digest(have) !== digest(text)) {
      bad++;
      console.error(`differs: ${file}`);
    }
  }
  if (bad) process.exit(1);
  console.log(`${files.size - 1} sticker pictures match`);
} else {
  await rm(OUT, { recursive: true, force: true });
  for (const [file, text] of files) {
    await mkdir(dirname(join(OUT, file)), { recursive: true });
    await writeFile(join(OUT, file), file.endsWith(".svgz") ? gzipSync(text, { level: 9 }) : text);
  }
  console.log(`${files.size - 1} stickers in ${index.categories.length} categories written to public/kidpix/sticker-svg/`);
}
