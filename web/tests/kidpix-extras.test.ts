import { describe, expect, it } from "vitest";
import { KIDPIX_CURSORS } from "@/components/DrawingSheet/kidpix/cursors";
import { grainPixels } from "@/components/DrawingSheet/kidpix/engine";
import { KIDPIX_HELP } from "@/components/DrawingSheet/kidpix/help";
import { KIDPIX_IDEAS } from "@/components/DrawingSheet/kidpix/ideas";
import { KIDPIX_KINDS } from "@/components/DrawingSheet/kidpix/kinds";
import { KIDPIX_PICKER, KIDPIX_PICKER_COLORS } from "@/components/DrawingSheet/kidpix/picker";
import { fillStamp, flipStamp, rotateStamp, setStampPixel } from "@/components/DrawingSheet/kidpix/stampEdit";
import { STAMP_EDITOR } from "@/components/DrawingSheet/kidpix/stampEditor";
import { PENCIL_CURSORS, STAMP_SIZES, TOOL_CURSORS } from "@/components/DrawingSheet/kidpix/tools";

const RED = [255, 0, 0, 255] as const;
const BLUE = [0, 0, 255, 255] as const;
/** A 3 px stamp, for the pixel tools: which pixels are red, row by row. */
const reds = (pixels: Uint8ClampedArray) =>
  Array.from({ length: 9 }, (_, at) => (pixels[at * 4] === 255 && pixels[at * 4 + 3] === 255 ? "x" : ".")).join("");

describe("the Stamp Editor's tools", () => {
  it("sets one pixel with the Pencil and leaves the rest", () => {
    const pixels = new Uint8ClampedArray(36);
    setStampPixel(pixels, 3, 1, 0, RED);
    setStampPixel(pixels, 3, 5, 5, RED);
    expect(reds(pixels)).toBe(".x.......");
  });

  it("fills only the area that touches, stopping at another color", () => {
    const pixels = new Uint8ClampedArray(36);
    // A blue wall down the middle column.
    for (let y = 0; y < 3; y++) setStampPixel(pixels, 3, 1, y, BLUE);
    fillStamp(pixels, 3, 0, 0, RED);
    expect(reds(pixels)).toBe("x..x..x..");
  });

  it("flips left to right and turns a quarter clockwise", () => {
    const pixels = new Uint8ClampedArray(36);
    setStampPixel(pixels, 3, 0, 0, RED);
    expect(reds(flipStamp(pixels, 3))).toBe("..x......");
    expect(reds(rotateStamp(pixels, 3))).toBe("..x......");
    setStampPixel(pixels, 3, 1, 0, RED);
    expect(reds(rotateStamp(pixels, 3))).toBe("..x..x...");
  });

  it("has every button of the disc's window, each in three states with a clip", () => {
    expect(Object.keys(STAMP_EDITOR.buttons)).toEqual([
      "pencil",
      "bucket",
      "undo",
      "firecracker",
      "flip",
      "rotate",
      "restore",
      "cancel",
      "ok",
    ]);
    for (const button of Object.values(STAMP_EDITOR.buttons)) {
      expect(button.states).toHaveLength(3);
      expect(button.clip).toMatch(/^stamped140\d\d$/);
    }
    expect(STAMP_SIZES).toEqual([32, 64, 128]);
  });
});

describe("paper texture", () => {
  it("keeps a stroke where the texture is light, thins it where dark, and leaves the rest alone", () => {
    const before = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 0, 10, 20, 30, 255, 9, 9, 9, 255]);
    const after = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 9, 9, 9, 255]);
    grainPixels(before, after, new Uint8Array([255, 0, 0, 0]));
    // Full texture keeps the paint; none puts back bare paper, or the paint that was under it.
    expect(Array.from(after)).toEqual([255, 0, 0, 255, 255, 0, 0, 0, 10, 20, 30, 255, 9, 9, 9, 255]);
  });

  it("keeps the stroke's own color on bare paper at half texture", () => {
    const after = new Uint8ClampedArray([200, 100, 50, 255]);
    grainPixels(new Uint8ClampedArray(4), after, new Uint8Array([128]));
    expect(Array.from(after.subarray(0, 3))).toEqual([200, 100, 50]);
    expect(after[3]).toBeGreaterThan(120);
    expect(after[3]).toBeLessThan(136);
  });
});

describe("the disc's tables", () => {
  it("has the Mixer's and the Eraser's kinds, two each", () => {
    for (const art of ["mixer", "eraser"] as const) {
      expect(KIDPIX_KINDS[art].kinds).toHaveLength(2);
      for (const kind of KIDPIX_KINDS[art].kinds)
        for (const cell of [...kind.putDown, ...kind.pickUp, ...kind.wiggle]) expect(KIDPIX_KINDS[art].cells[cell]).toBeDefined();
    }
  });

  it("has 29 cursors, and one for every tool", () => {
    expect(KIDPIX_CURSORS).toHaveLength(29);
    for (const index of [...PENCIL_CURSORS, ...Object.values(TOOL_CURSORS)]) {
      const [url, x, y] = KIDPIX_CURSORS[index];
      expect(url).toMatch(/^data:image\/png;base64,/);
      expect(x).toBeLessThan(32);
      expect(y).toBeLessThan(32);
    }
  });

  it("reads the picker's colors off its grid: grays, the colors, and skin tones", () => {
    expect(KIDPIX_PICKER_COLORS.length).toBeGreaterThan(75);
    const colors = KIDPIX_PICKER_COLORS.map((swatch) => swatch[4]);
    expect(colors).toContain("#000000");
    for (const [x, y, width, height, color] of KIDPIX_PICKER_COLORS) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
      expect(x + width).toBeLessThanOrEqual(KIDPIX_PICKER.grid.cell[2]);
      expect(y + height).toBeLessThanOrEqual(KIDPIX_PICKER.grid.cell[3]);
    }
  });

  it("has a narrated line for each part of the screen the question mark knows", () => {
    for (const [clip, text] of Object.values(KIDPIX_HELP)) {
      expect(clip).toBeGreaterThanOrEqual(9000);
      expect(clip).toBeLessThan(9180);
      expect(text.length).toBeGreaterThan(10);
    }
    expect(KIDPIX_HELP.eraser[1]).toBe("Use these tools to erase part or all of your picture.");
  });

  it("has the Idea Machine's 572 picture starters in 52 folders", () => {
    expect(KIDPIX_IDEAS).toHaveLength(52);
    expect(KIDPIX_IDEAS.reduce((count, folder) => count + folder.items.length, 0)).toBe(572);
    expect(new Set(KIDPIX_IDEAS.map((folder) => folder.slug)).size).toBe(52);
    expect(new Set(KIDPIX_IDEAS.map((folder) => folder.topic)).size).toBe(9);
  });
});

describe("the letter stamps' spoken names", () => {
  it("has a clip for each digit and mark after the alphabet", async () => {
    const { KIDPIX_SOUND_SPRITE } = await import("@/components/DrawingSheet/kidpix/data");
    const sprite = KIDPIX_SOUND_SPRITE as Record<string, readonly number[]>;
    for (let clip = 22026; clip <= 22050; clip++) expect(sprite[`stamp${clip}`]?.[1]).toBeGreaterThan(0);
  });
});
