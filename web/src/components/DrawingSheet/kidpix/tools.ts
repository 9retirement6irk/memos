import { KIDPIX_TOOL_NAMES } from "./data";
import type { MixEffect } from "./raster";

/** The tools on the tube. `row` and `frames` locate the button's animation in assets/tools.png. */
export type KidPixTool = "pencil" | "wacky" | "paint" | "mixer" | "eraser" | "stamp" | "text" | "move" | "sticker" | "background";

export interface TubeTool {
  key: KidPixTool;
  /** Kid Pix's own name for the tool; a product name, so it is not translated. */
  name: string;
  row: number;
  frames: number;
  /** Clip the button's "selected" script plays (Easel.MHK script 1014 for the pencil, and so on). */
  selectSound: string;
  /** Clip its hover script plays: one for the paint tools, another for the library tools. */
  hoverSound: string;
}

export const TUBE_TOOLS: readonly TubeTool[] = [
  { key: "pencil", name: "Pencil", row: 0, frames: 5, selectSound: "easel1036", hoverSound: "easel1002" },
  { key: "wacky", name: "Wacky Brush", row: 1, frames: 6, selectSound: "easel1045", hoverSound: "easel1002" },
  { key: "paint", name: "Paint Can", row: 2, frames: 6, selectSound: "easel1035", hoverSound: "easel1002" },
  { key: "mixer", name: "Electric Mixer", row: 3, frames: 6, selectSound: "easel1039", hoverSound: "easel1002" },
  { key: "eraser", name: "Eraser", row: 4, frames: 6, selectSound: "easel1043", hoverSound: "easel1002" },
  { key: "stamp", name: "Stamps", row: 5, frames: 5, selectSound: "easel1034", hoverSound: "easel1002" },
  { key: "text", name: "Text", row: 6, frames: 5, selectSound: "easel1038", hoverSound: "easel1002" },
  { key: "move", name: "Moving Van", row: 7, frames: 6, selectSound: "easel1040", hoverSound: "easel1002" },
  { key: "sticker", name: "Stickers", row: 9, frames: 5, selectSound: "easel1044", hoverSound: "easel1000" },
  { key: "background", name: "Backgrounds", row: 8, frames: 5, selectSound: "easel1031", hoverSound: "easel1000" },
];

/** Undo Guy's lines; Easel.MHK scripts 1083 to 1102 each pair one with his lip movements. */
export const UNDO_GUY_LINES: readonly string[] = [
  ...[1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014, 1015, 1018, 1019, 1021, 1022, 1023, 1024, 1026, 1046, 1047, 1048, 1049].map(
    (id) => `easel${id}`,
  ),
];

/** Undo Guy's face at rest in assets/undoguy.png: frame 156 of Easel.MHK, the one his idle script shows. */
export const UNDO_GUY_REST = 43;

/** His mouth shapes; frames 0 to 7 of the strip are other buttons and frame 24 is only his eyes. */
export const UNDO_GUY_TALKING: readonly number[] = Array.from({ length: 40 }, (_, index) => index + 8).filter((frame) => frame !== 24);

/** Kid Pix tool numbers (see KIDPIX_TOOL_NAMES) the tube tools stand for. */
export const TOOL_NUMBER = {
  pencil: 99,
  fillSolid: 116,
  fillPattern: 117,
  fillGradient: 118,
  firstMixer: 65,
  firstWand: 87,
  firstScreenEraser: 123,
} as const;

/** Pencil and eraser sizes, in drawing px. */
export const PENCIL_SIZES = [2, 5, 9, 15, 24] as const;
export const ERASER_SIZES = [8, 16, 28, 44] as const;

/** Brush icons 0 to 44 draw; 45 and up are Kid Pix's voice brushes, which need a microphone. */
export const BRUSH_COUNT = 45;
export const MIXER_COUNT = 22;
export const WAND_COUNT = 12;
export const SCREEN_ERASER_COUNT = 16;
export const PATTERN_COUNT = 49;
export const GRADIENT_COUNT = 63;

/** "LeakyPen" reads as "Leaky Pen". */
export const toolLabel = (toolNumber: number) => (KIDPIX_TOOL_NAMES[toolNumber] ?? "").replace(/([a-z])([A-Z0-9])/g, "$1 $2");

/** The effect standing in for each whole-picture mixer, by its position in the tray (tools 65 to 86). */
export const MIXER_EFFECTS: readonly MixEffect[] = [
  "invert", // XRay
  "nuclear",
  "emboss",
  "lighten",
  "sepia",
  "colorize",
  "hue", // ColorCycle
  "grayscale", // StripColor
  "speckle", // Pointilize
  "posterize",
  "solarize",
  "pinch",
  "bulge", // Spherize
  "ripple",
  "mosaic", // Bubbles
  "blur", // Burlap
  "whirl",
  "zoom", // Pulse
  "wave", // Wavelet
  "shear",
  "flip",
  "kaleidoscope",
];

/** The effect each mixer wand brushes on (tools 87 to 98). */
export const WAND_EFFECTS: readonly MixEffect[] = [
  "speckle", // SmearBrush
  "blur",
  "grayscale",
  "colorize",
  "invert", // XRayBrush
  "emboss",
  "edge",
  "nuclear",
  "solarize",
  "hue",
  "posterize",
  "mosaic",
];

/** The Kid Pix palette: 40 colors, the first row the classic bright ones. */
export const PALETTE: readonly string[] = [
  "#000000",
  "#ffffff",
  "#808080",
  "#c0c0c0",
  "#ff0000",
  "#ff8000",
  "#ffff00",
  "#80ff00",
  "#00c000",
  "#00ff80",
  "#00ffff",
  "#0080ff",
  "#0000ff",
  "#8000ff",
  "#ff00ff",
  "#ff0080",
  "#800000",
  "#804000",
  "#808000",
  "#408000",
  "#006000",
  "#008060",
  "#008080",
  "#004080",
  "#000080",
  "#400080",
  "#800080",
  "#800040",
  "#ffc0c0",
  "#ffe0c0",
  "#ffffc0",
  "#c0ffc0",
  "#c0ffff",
  "#c0e0ff",
  "#c0c0ff",
  "#ffc0ff",
  "#8b5a2b",
  "#d2a679",
  "#f4c2a1",
  "#ffd700",
];

/** The Kid Pix fonts shipped in assets, as declared in kidpix.css. */
export const FONTS: readonly { family: string; name: string }[] = [
  { family: "KidPixCatchup", name: "Catchup" },
  { family: "KidPixMarket", name: "Market" },
  { family: "KidPixStorybook", name: "Storybook" },
  { family: "KidPixGremlin", name: "Gremlin" },
  { family: "KidPixTubular", name: "Tubular" },
  { family: "KidPixJester", name: "Jester" },
  { family: "KidPixCuckoo", name: "Cuckoo" },
  { family: "KidPixFlatBrush", name: "Flat Brush" },
];

export const TEXT_SIZE = 44;
