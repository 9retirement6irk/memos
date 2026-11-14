import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { KIDPIX_SOUND_SPRITE, KIDPIX_TOOL_NAMES, KIDPIX_TOOL_SOUNDS } from "@/components/DrawingSheet/kidpix/data";
import { KIDPIX_KINDS } from "@/components/DrawingSheet/kidpix/kinds";
import { floodMask, mixPixels, paintBounds, planTiles } from "@/components/DrawingSheet/kidpix/raster";
import { REALISTIC_BRUSHES } from "@/components/DrawingSheet/kidpix/tips";
import {
  BUCKET_KINDS,
  FONTS,
  MIXER_COUNT,
  MIXER_EFFECTS,
  PENCIL_SHAPES,
  PENCIL_WIDTHS,
  REALISTIC_COUNT,
  TUBE_TOOLS,
  textFont,
  UNDO_GUY_LINES,
  WAND_COUNT,
  WAND_EFFECTS,
} from "@/components/DrawingSheet/kidpix/tools";

/** A white picture with opaque pixels where `ink` says so. */
const picture = (width: number, height: number, ink: (x: number, y: number) => boolean) => {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (ink(x, y)) data.set([0, 0, 0, 255], (y * width + x) * 4);
    }
  }
  return data;
};

describe("Kid Pix pixel work", () => {
  it("fills only the area the outline encloses", () => {
    // A 6 x 6 box outline in a 10 x 10 picture.
    const onOutline = (x: number, y: number) => x >= 2 && x <= 7 && y >= 2 && y <= 7 && (x === 2 || x === 7 || y === 2 || y === 7);
    const data = picture(10, 10, onOutline);
    const inside = floodMask(data, 10, 10, 4, 4);
    expect(inside.box).toEqual({ x: 3, y: 3, width: 4, height: 4 });
    expect(inside.mask.reduce((sum, value) => sum + value, 0)).toBe(16);
    const outside = floodMask(data, 10, 10, 0, 0);
    expect(outside.mask.reduce((sum, value) => sum + value, 0)).toBe(100 - 36);
  });

  it("finds the box around the paint, and none on an empty layer", () => {
    const data = new Uint8ClampedArray(8 * 8 * 4);
    expect(paintBounds(data, 8, 8)).toBeNull();
    data[(2 * 8 + 3) * 4 + 3] = 255;
    data[(5 * 8 + 6) * 4 + 3] = 1;
    expect(paintBounds(data, 8, 8)).toEqual({ x: 3, y: 2, width: 4, height: 4 });
  });

  it("cuts the paint into tiles that cover it exactly and fit the limit", () => {
    const box = { x: 10, y: 20, width: 1872, height: 1032 };
    const tiles = planTiles(box, 825);
    expect(tiles).toHaveLength(6);
    expect(tiles.every((tile) => tile.width <= 825 && tile.height <= 825)).toBe(true);
    expect(tiles.reduce((area, tile) => area + tile.width * tile.height, 0)).toBe(box.width * box.height);
    expect(planTiles({ x: 0, y: 0, width: 100, height: 50 }, 1440)).toEqual([{ x: 0, y: 0, width: 100, height: 50 }]);
  });

  it("mixes in place and keeps the picture opaque", () => {
    const data = picture(4, 4, (x, y) => x === 0 && y === 0);
    mixPixels(data, 4, 4, "invert");
    expect(Array.from(data.slice(0, 4))).toEqual([255, 255, 255, 255]);
    expect(Array.from(data.slice(4, 8))).toEqual([0, 0, 0, 255]);
    mixPixels(data, 4, 4, "flip");
    // Flip mirrors left to right, as Kid Pix's does.
    expect(Array.from(data.slice(3 * 4, 3 * 4 + 4))).toEqual([255, 255, 255, 255]);
    // The color mixers give the values measured in Kid Pix: brightness is the strongest channel.
    const green = () => new Uint8ClampedArray([0, 255, 0, 255, 189, 255, 189, 255]);
    const mixed = (effect: (typeof MIXER_EFFECTS)[number]) => {
      const pixels = green();
      mixPixels(pixels, 2, 1, effect, [0, 255, 0]);
      return Array.from(pixels);
    };
    expect(mixed("sepia")).toEqual([255, 189, 132, 255, 255, 189, 132, 255]);
    expect(mixed("grayscale")).toEqual([255, 255, 255, 255, 255, 255, 255, 255]);
    expect(mixed("lighten")).toEqual([8, 255, 8, 255, 197, 255, 197, 255]);
    expect(mixed("solarize")).toEqual([0, 0, 0, 255, 0, 0, 0, 255]);
    expect(mixed("nuclear")).toEqual([255, 0, 255, 255, 255, 189, 255, 255]);
    expect(mixed("hue").slice(0, 3)).toEqual([0, 255, 128]);
    for (const effect of new Set([...MIXER_EFFECTS, ...WAND_EFFECTS])) {
      mixPixels(data, 4, 4, effect, [255, 0, 128], () => 0.5);
      expect(data.filter((_, index) => index % 4 === 3).every((alpha) => alpha === 255)).toBe(true);
    }
  });
});

describe("Kid Pix tables", () => {
  it("has three tips inside the sheet for each of the twenty Realistic brushes", () => {
    expect(REALISTIC_BRUSHES).toHaveLength(REALISTIC_COUNT);
    for (const brush of REALISTIC_BRUSHES) {
      expect(brush.tips).toHaveLength(3);
      for (const [x, y, width, height] of brush.tips) {
        // assets/brush-tips.png is 20 x 3 cells of 32 px.
        expect(x % 32).toBe(0);
        expect(y % 32).toBe(0);
        expect(width).toBeLessThanOrEqual(32);
        expect(height).toBeLessThanOrEqual(32);
        expect(x + width).toBeLessThanOrEqual(640);
        expect(y + height).toBeLessThanOrEqual(96);
      }
      expect(brush.spacing).toBeGreaterThan(0);
      expect(brush.density).toBeGreaterThan(0);
    }
    expect(existsSync(resolve(__dirname, "../src/components/DrawingSheet/kidpix/assets/brush-tips.png"))).toBe(true);
  });

  it("has an effect for every mixer and wand in the tray", () => {
    expect(MIXER_EFFECTS).toHaveLength(MIXER_COUNT);
    expect(WAND_EFFECTS).toHaveLength(WAND_COUNT);
  });

  it("gives each Pencil shape Kid Pix's own tool, and has three Fill Buckets", () => {
    expect(PENCIL_SHAPES.map((shape) => KIDPIX_TOOL_NAMES[shape.tool])).toEqual([
      "Circle",
      "ModifierLine",
      "ModifierCurve",
      "ModifierOSquare",
      "ModifierFSquare",
      "ModifierOCircle",
      "ModifierFCircle",
      "ModifierOPoly",
      "ModifierFPoly",
    ]);
    for (const shape of PENCIL_SHAPES) expect(KIDPIX_TOOL_SOUNDS[shape.tool], shape.name).toBeDefined();
    expect(BUCKET_KINDS).toHaveLength(3);
  });

  it("has every frame and clip the tray's tool kinds are scripted to show and play", () => {
    for (const [name, group] of Object.entries(KIDPIX_KINDS)) {
      for (const [x, y, width, height] of group.cells) {
        expect(x + width, name).toBeLessThanOrEqual(group.sheet[0]);
        expect(y + height, name).toBeLessThanOrEqual(group.sheet[1]);
      }
      for (const kind of group.kinds) {
        for (const script of [kind.putDown, kind.pickUp, kind.wiggle]) {
          expect(script.length, name).toBeGreaterThan(0);
          for (const cell of script) expect(group.cells[cell], name).toBeDefined();
        }
        for (const clip of kind.sounds) expect(KIDPIX_SOUND_SPRITE[clip], clip).toBeDefined();
      }
    }
    expect(KIDPIX_KINDS.pencil.kinds).toHaveLength(4);
    expect(KIDPIX_KINDS.brush.kinds).toHaveLength(2);
    expect(KIDPIX_KINDS.bucket.kinds).toHaveLength(3);
  });

  it("draws each kind of pencil at three sizes, and ships a file for every font in the text tray", () => {
    expect(PENCIL_WIDTHS).toHaveLength(4);
    for (const widths of PENCIL_WIDTHS) expect([...widths].sort((x, y) => x - y)).toEqual([...widths]);
    expect(FONTS).toHaveLength(22);
    const css = readFileSync(resolve(__dirname, "../src/components/DrawingSheet/kidpix/kidpix.css"), "utf8");
    for (const font of FONTS) {
      const file = new RegExp(`font-family: ${font.family};\\s+src: url\\("\\./assets/([a-z]+\\.woff)"\\)`).exec(css)?.[1];
      expect(file, font.name).toBeDefined();
      expect(existsSync(resolve(__dirname, "../src/components/DrawingSheet/kidpix/assets", file ?? "")), font.name).toBe(true);
    }
    expect(textFont({ family: "KidPixJester", size: 48, bold: true, italic: true, underline: false, align: "left" }, 2)).toBe(
      "italic bold 96px KidPixJester",
    );
  });

  it("names every tool Kid Pix has and finds each of their clips in the sprite", () => {
    expect(KIDPIX_TOOL_NAMES).toHaveLength(139);
    expect(KIDPIX_TOOL_NAMES[99]).toBe("Circle");
    for (const [tool, clips] of Object.entries(KIDPIX_TOOL_SOUNDS)) {
      expect(KIDPIX_TOOL_NAMES[Number(tool)]).toBeTruthy();
      for (const clip of clips) {
        if (clip) expect(KIDPIX_SOUND_SPRITE[`w${clip}`], `tool ${tool} clip ${clip}`).toBeDefined();
      }
    }
    for (const clip of [
      ...TUBE_TOOLS.map((tool) => tool.selectSound),
      ...UNDO_GUY_LINES.map((line) => line.clip),
      "easel1002",
      "easel1027",
      "easel1028",
      "easel1029",
    ]) {
      expect(KIDPIX_SOUND_SPRITE[clip], clip).toBeDefined();
    }
    for (const clip of ["misc31504", "splash1000", "w7320", "w7429", "w7430", "letterA", "letterZ"]) {
      expect(KIDPIX_SOUND_SPRITE[clip], clip).toBeDefined();
    }
  });
});
