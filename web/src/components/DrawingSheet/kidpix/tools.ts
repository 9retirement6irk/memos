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
  // In the tube's own order, two to a row.
  { key: "pencil", name: "Pencil", row: 0, frames: 5, selectSound: "easel1036", hoverSound: "easel1002" },
  { key: "text", name: "Text", row: 6, frames: 5, selectSound: "easel1038", hoverSound: "easel1002" },
  { key: "wacky", name: "Wacky Brush", row: 1, frames: 6, selectSound: "easel1045", hoverSound: "easel1002" },
  { key: "paint", name: "Paint Can", row: 2, frames: 6, selectSound: "easel1035", hoverSound: "easel1002" },
  { key: "sticker", name: "Stickers", row: 9, frames: 5, selectSound: "easel1044", hoverSound: "easel1000" },
  { key: "stamp", name: "Stamps", row: 5, frames: 5, selectSound: "easel1034", hoverSound: "easel1002" },
  { key: "mixer", name: "Electric Mixer", row: 3, frames: 6, selectSound: "easel1039", hoverSound: "easel1002" },
  { key: "background", name: "Backgrounds", row: 8, frames: 5, selectSound: "easel1031", hoverSound: "easel1000" },
  { key: "move", name: "Moving Van", row: 7, frames: 6, selectSound: "easel1040", hoverSound: "easel1002" },
  { key: "eraser", name: "Eraser", row: 4, frames: 6, selectSound: "easel1043", hoverSound: "easel1002" },
];

/**
 * Undo Guy's lines, with the mouth shapes Kid Pix shows through each one: Easel.MHK scripts 1083
 * to 1102, a frame of assets/undoguy.png per step, spread evenly over the clip.
 */
export const UNDO_GUY_LINES: readonly { clip: string; frames: readonly number[] }[] = [
  { clip: "easel1007", frames: [35, 2, 9, 22, 3, 7, 25, 1, 21, 35, 23, 38, 41, 42, 41, 25, 48, 0, 13, 15, 12, 7, 0, 35, 35, 35, 35] },
  { clip: "easel1008", frames: [25, 18, 24, 8, 15, 21, 5, 10, 26, 48, 35, 35, 35] },
  { clip: "easel1009", frames: [27, 28, 3, 35, 47, 7, 28, 0, 21, 0, 26, 2, 10, 6, 28, 32, 35, 35, 32, 35] },
  { clip: "easel1010", frames: [9, 37, 41, 26, 39, 44, 35, 35, 35, 35] },
  { clip: "easel1011", frames: [6, 15, 36, 41, 42, 29, 39, 45, 25, 41, 3, 5, 27, 2, 25, 35, 35, 35, 35] },
  { clip: "easel1012", frames: [15, 35, 47, 32, 23, 28, 48, 49, 50, 35, 35, 35] },
  { clip: "easel1013", frames: [35, 4, 15, 7, 37, 41, 35, 35, 35] },
  { clip: "easel1014", frames: [35, 5, 15, 39, 45, 44, 35, 35, 35, 35] },
  { clip: "easel1015", frames: [3, 15, 45, 31, 11, 40, 43, 35, 35, 35, 35] },
  { clip: "easel1046", frames: [38, 0, 15, 19, 28, 25, 35, 0, 43] },
  { clip: "easel1047", frames: [35, 42, 35, 35, 35] },
  { clip: "easel1018", frames: [4, 15, 28, 37, 41, 0, 29, 35, 43, 35, 35, 35, 35] },
  { clip: "easel1019", frames: [35, 44, 14, 28, 34, 1, 31, 4, 25, 35] },
  { clip: "easel1048", frames: [35, 14, 35, 23, 35, 35, 14, 35] },
  { clip: "easel1021", frames: [48, 51, 12, 34, 20, 45, 35, 35, 35, 35] },
  { clip: "easel1022", frames: [30, 51, 35, 7, 35, 25, 28, 35, 35, 35] },
  { clip: "easel1023", frames: [4, 14, 2, 15, 4, 1, 35, 35, 35, 35] },
  { clip: "easel1024", frames: [31, 37, 30, 45, 29, 2, 39, 41, 35] },
  { clip: "easel1049", frames: [0, 35, 0, 35, 35, 34, 17, 35, 0, 35, 0, 35, 35, 0] },
  { clip: "easel1026", frames: [15, 41, 17, 13, 14, 3, 25, 35] },
];

/** His face at rest: frame 156 of Easel.MHK, the one his idle script shows. */
export const UNDO_GUY_REST = 35;

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

/**
 * The Pencil tool's four kinds, as in Kid Pix's tray: tools 99 to 102, each with its own sounds.
 * Their button art is assets/pencils.png, colored through assets/pencils-mask.png.
 */
export const PENCIL_KINDS = ["Pencil", "Chalk", "Crayon", "Marker"] as const;

/**
 * The brush zone's kinds: the paint brush with its Wacky Brushes, and the Spray Can. Kid Pix has a
 * third between them, Sound Art, which paints with the microphone. Art: assets/brushkinds.png.
 */
/**
 * The shapes the Pencil's four kinds draw, in the tray's order: Kid Pix's modifier tools 103 to
 * 110, each with its own sounds. Icons: assets/shapes.png.
 */
export const PENCIL_SHAPES: readonly {
  name: string;
  kind: "free" | "line" | "curve" | "rect" | "oval" | "polygon";
  filled: boolean;
  tool: number;
}[] = [
  { name: "Freehand", kind: "free", filled: false, tool: 99 },
  { name: "Straight Line", kind: "line", filled: false, tool: 103 },
  { name: "Curve", kind: "curve", filled: false, tool: 104 },
  { name: "Rectangle", kind: "rect", filled: false, tool: 105 },
  { name: "Filled Rectangle", kind: "rect", filled: true, tool: 106 },
  { name: "Oval", kind: "oval", filled: false, tool: 107 },
  { name: "Filled Oval", kind: "oval", filled: true, tool: 108 },
  { name: "Polygon", kind: "polygon", filled: false, tool: 109 },
  { name: "Filled Polygon", kind: "polygon", filled: true, tool: 110 },
];

/** The three Fill Buckets, as the tray's first panel shows them. Art: assets/bucketkinds.png. */
export const BUCKET_KINDS = ["Solid Fill Bucket", "Blend Fill Bucket", "Pattern Fill Bucket"] as const;
/** The Solid bucket's one-color patterns; the first is plain color. Icons: assets/solids.png. */
export const SOLID_COUNT = 42;

export const BRUSH_KINDS = ["Paint Brush", "Spray Can"] as const;

/** Pencil and eraser sizes, in drawing px. */
/**
 * How wide each of the Pencil's kinds draws at Kid Pix's three sizes, in drawing px, measured
 * from the original: pencil, chalk, crayon, marker.
 */
export const PENCIL_WIDTHS: readonly (readonly [number, number, number])[] = [
  [1, 10, 20],
  [8, 12, 18],
  [8, 14, 22],
  [10, 17, 23],
];
/** How much a paint brush grows or shrinks at the three sizes. */
export const BRUSH_SCALES = [0.6, 1, 1.6] as const;
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
  { family: "KidPixDiploma", name: "Diploma" },
  { family: "KidPixEurasia", name: "Eurasia" },
  { family: "KidPixExpose", name: "Expose" },
  { family: "KidPixFifthAve", name: "Fifth Ave" },
  { family: "KidPixFranciscan", name: "Franciscan" },
  { family: "KidPixJolt", name: "Jolt" },
  { family: "KidPixKeiraCondensed", name: "Keira Condensed" },
  { family: "KidPixPatrick", name: "Patrick" },
  { family: "KidPixPegasus", name: "Pegasus" },
  { family: "KidPixSocket", name: "Socket" },
  { family: "KidPixTechno", name: "Techno" },
  { family: "KidPixTeletype", name: "Teletype" },
  { family: "KidPixTabloid", name: "Tabloid" },
  { family: "KidPixVogel", name: "Vogel" },
];

/** The sizes the text tray offers, in drawing px, and the one it starts on. */
export const TEXT_SIZES = [12, 18, 24, 36, 48, 72, 96] as const;
/** A line of text is this many times its size apart from the next. */
export const TEXT_LINE = 1.2;

export interface TextStyle {
  family: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: "left" | "center" | "right";
}

/** The CSS and canvas font for a text style, at a scale. */
export const textFont = (style: TextStyle, scale = 1) =>
  `${style.italic ? "italic " : ""}${style.bold ? "bold " : ""}${style.size * scale}px ${style.family}`;

export const TEXT_SIZE = 48;
