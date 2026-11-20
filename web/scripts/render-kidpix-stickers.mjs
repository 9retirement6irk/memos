// Renders the Kid Pix stickers (public/kidpix/stickers/<slug>.bin: small Flash movies, see
// src/components/DrawingSheet/kidpix/swf.ts) to PNG pictures, for apps that can't read Flash:
// GZreader's drawing screen on a Kindle fetches them from this server.
//
//   node scripts/render-kidpix-stickers.mjs [--check]
//
// Writes public/kidpix/sticker-png/<slug>/<n>.png (n from 0, in the library's order), each
// sticker at twice its frame's size (crisp on a 300 dpi screen) on a transparent ground, and
// public/kidpix/sticker-png/index.json:
//   { version, scale, categories: [{ slug, name, items: [{ name, file, width, height }] }] }
// width and height are the frame's own size in px (what the sticker is at 1x).
// --check: render, and fail if anything differs from what's there (CI-style).
// Uses swf.ts itself (types stripped by Node) in a headless Chromium (Playwright).

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { chromium } from "@playwright/test";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const KIDPIX = join(WEB, "src/components/DrawingSheet/kidpix");
const OUT = join(WEB, "public/kidpix/sticker-png");
const SCALE = 2;
const check = process.argv.includes("--check");

// ---------------------------------------------------------------- 256-colour PNGs
// A sticker's anti-aliased edges give it thousands of colours; 256 (an octree over red, green,
// blue and alpha) look the same and make the files about a quarter of the size of full colour.

const MAX_DEPTH = 5;
const childIndex = (r, g, b, a, level) => {
  const shift = 7 - level;
  return (((r >> shift) & 1) << 3) | (((g >> shift) & 1) << 2) | (((b >> shift) & 1) << 1) | ((a >> shift) & 1);
};

const palettize = (rgba) => {
  const root = { children: [], count: 0, r: 0, g: 0, b: 0, a: 0, leaf: false };
  const levels = Array.from({ length: MAX_DEPTH }, () => []);
  let leaves = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i],
      g = rgba[i + 1],
      b = rgba[i + 2],
      a = rgba[i + 3];
    if (a === 0) continue; // (fully clear: palette entry 0)
    let node = root;
    for (let level = 0; level < MAX_DEPTH && !node.leaf; level++) {
      const k = childIndex(r, g, b, a, level);
      if (!node.children[k]) {
        node.children[k] = { children: [], count: 0, r: 0, g: 0, b: 0, a: 0, leaf: level === MAX_DEPTH - 1 };
        if (node.children[k].leaf) leaves++;
        else levels[level + 1]?.push(node.children[k]);
        if (level === 0) levels[0].push(node.children[k]);
      }
      node = node.children[k];
    }
    node.count++;
    node.r += r;
    node.g += g;
    node.b += b;
    node.a += a;
  }
  // fold the deepest nodes into their parents until 255 colours are left (one more for clear)
  const fold = (node) => {
    let n = 0;
    for (const c of node.children) {
      if (!c) continue;
      node.count += c.count;
      node.r += c.r;
      node.g += c.g;
      node.b += c.b;
      node.a += c.a;
      n++;
    }
    node.children = [];
    node.leaf = true;
    return n;
  };
  for (let level = MAX_DEPTH - 1; level >= 0 && leaves > 255; level--) {
    const nodes = levels[level].filter((nd) => !nd.leaf).sort((x, y) => x.count - y.count);
    for (const nd of nodes) {
      if (leaves <= 255) break;
      leaves -= fold(nd) - 1;
    }
  }
  const palette = [[0, 0, 0, 0]];
  const number = (node) => {
    if (node.leaf) {
      node.index = palette.length;
      const n = Math.max(1, node.count);
      palette.push([Math.round(node.r / n), Math.round(node.g / n), Math.round(node.b / n), Math.round(node.a / n)]);
      return;
    }
    for (const c of node.children) if (c) number(c);
  };
  for (const c of root.children) if (c) number(c);
  const indexed = new Uint8Array(rgba.length / 4);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    const a = rgba[i + 3];
    if (a === 0) continue;
    let node = root;
    for (let level = 0; !node.leaf; level++) node = node.children[childIndex(rgba[i], rgba[i + 1], rgba[i + 2], a, level)];
    indexed[p] = node.index;
  }
  return { palette, indexed };
};

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
};

/** RGBA pixels as an indexed PNG (palette + transparency). */
const png8 = (rgba, width, height) => {
  const { palette, indexed } = palettize(rgba);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // indexed colour
  const rows = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) indexed.subarray(y * width, (y + 1) * width).forEach((v, x) => (rows[y * (width + 1) + 1 + x] = v));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("PLTE", Buffer.from(palette.flatMap(([r, g, b]) => [r, g, b]))),
    chunk("tRNS", Buffer.from(palette.map(([, , , a]) => a))),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

// ---------------------------------------------------------------- rendering

// swf.ts and library.ts as plain scripts: their exports become globals of the page
const asScript = async (file) => {
  const js = stripTypeScriptTypes(await readFile(join(KIDPIX, file), "utf8"), { mode: "transform" });
  return js.replace(/^export const /gm, "window.").replace(/^export (interface|type) /gm, "$1 ");
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<!doctype html><title>stickers</title>");
await page.addScriptTag({ content: await asScript("library.ts") });
await page.addScriptTag({ content: await asScript("swf.ts") });

const categories = await page.evaluate(() => window.KIDPIX_STICKERS.map((c) => ({ slug: c.slug, name: c.name, items: c.items })));
const index = { version: 1, scale: SCALE, categories: [] };
const files = new Map(); // relative path → bytes
for (const cat of categories) {
  const bytes = await readFile(join(WEB, "public/kidpix/stickers", `${cat.slug}.bin`));
  const rendered = await page.evaluate(
    async ({ b64, lengths, scale }) => {
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const pictures = window.readStickers(raw, lengths);
      const out = [];
      for (const p of pictures) {
        const w = Math.max(1, Math.round(p.width)),
          h = Math.max(1, Math.round(p.height));
        const canvas = new OffscreenCanvas(w * scale, h * scale);
        const ctx = canvas.getContext("2d");
        ctx.scale(scale, scale);
        p.draw(ctx);
        const px = ctx.getImageData(0, 0, w * scale, h * scale).data;
        let str = "";
        for (let i = 0; i < px.length; i += 0x8000) str += String.fromCharCode(...px.subarray(i, i + 0x8000));
        out.push({ width: w, height: h, rgba: btoa(str) });
      }
      return out;
    },
    { b64: bytes.toString("base64"), lengths: cat.items.map((it) => it[1]), scale: SCALE },
  );
  const items = rendered.map((r, n) => {
    const file = `${cat.slug}/${n}.png`;
    files.set(file, png8(Buffer.from(r.rgba, "base64"), r.width * SCALE, r.height * SCALE));
    return { name: cat.items[n][0], file, width: r.width, height: r.height };
  });
  index.categories.push({ slug: cat.slug, name: cat.name, items });
}
await browser.close();
files.set("index.json", Buffer.from(`${JSON.stringify(index, null, 1)}\n`));

const digest = (b) => createHash("sha256").update(b).digest("hex");
if (check) {
  let bad = 0;
  for (const [file, data] of files) {
    const have = await readFile(join(OUT, file)).catch(() => null);
    if (!have || digest(have) !== digest(data)) {
      bad++;
      console.error(`differs: ${file}`);
    }
  }
  if (bad) process.exit(1);
  console.log(`${files.size - 1} sticker pictures match`);
} else {
  await rm(OUT, { recursive: true, force: true });
  for (const [file, data] of files) {
    await mkdir(dirname(join(OUT, file)), { recursive: true });
    await writeFile(join(OUT, file), data);
  }
  const n = (await readdir(OUT)).length - 1;
  console.log(`${files.size - 1} sticker pictures in ${n} categories written to public/kidpix/sticker-png/`);
}
