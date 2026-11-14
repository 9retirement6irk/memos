import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import brushPartsUrl from "./assets/brush-parts.png";
import tipsUrl from "./assets/brush-tips.png";
import brushWindowUrl from "./assets/brush-window.png";
import fillsUrl from "./assets/fills.jpg";
import gradientsUrl from "./assets/grad.png";
import lettersUrl from "./assets/letters.png";
import solidTilesUrl from "./assets/solid-tiles.png";
import soundsUrl from "./assets/sounds.m4a";
import { KidPixAudio } from "./audio";
import type { Point } from "./brushes";
import { KIDPIX_TOOL_SOUNDS } from "./data";
import { KidPixEngine, type KidPixImages, type KidPixPicture, type KidPixTile } from "./engine";
import "./kidpix.css";
import KindPanel, { type KindArt } from "./KindPanel";
import { KIDPIX_BACKGROUNDS, KIDPIX_STAMPS, KIDPIX_STICKERS } from "./library";
import { KIDPIX_SPRAY_SETS } from "./spray";
import { readStickers, type SwfPicture } from "./swf";
import {
  BRUSH_COUNT,
  BRUSH_KINDS,
  BUCKET_KINDS,
  ERASER_TIPS,
  FONTS,
  GRADIENT_COUNT,
  type KidPixTool,
  MIXER_COUNT,
  PALETTE,
  PATTERN_COUNT,
  PENCIL_KINDS,
  PENCIL_SHAPES,
  REALISTIC_COUNT,
  SCREEN_ERASER_COUNT,
  SOLID_COUNT,
  TEXT_LINE,
  TEXT_SIZE,
  TEXT_SIZES,
  type TextStyle,
  TOOL_NUMBER,
  TUBE_TOOLS,
  textFont,
  toolLabel,
  UNDO_GUY_LINES,
  UNDO_GUY_REST,
  WAND_COUNT,
} from "./tools";

/** Where the drawing sat when Kid Pix mode began: the canvas viewport and the surface's size in CSS px. */
export interface KidPixView {
  zoom: number;
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
}

export interface KidPixHandle {
  hasPaint: () => boolean;
  /** The paint as picture tiles in layer px, which are drawing px from the view's top-left corner. */
  takeTiles: (maxSide: number) => Promise<KidPixTile[]>;
  /**
   * Brings pictures onto the paper, as Kid Pix's Add Graphic does. Each lands in the sticker's
   * frame, to move, resize and flip; the one before it is pressed into the paint. Resolves to
   * how many could not be read.
   */
  addPictures: (files: readonly File[]) => Promise<number>;
}

export interface KidPixLayerProps {
  ref?: Ref<KidPixHandle>;
  view: KidPixView;
  paper: string;
  muted: boolean;
  /** The one-panel chrome for a phone; otherwise the tube and the tray. */
  compact: boolean;
  /** The drawing's canvases, so the Paint Can and the mixers see what is under the paint. */
  backdropSources: () => HTMLCanvasElement[];
  labels: {
    tools: string;
    color: string;
    undo: string;
    clear: string;
    previous: string;
    next: string;
    noBackground: string;
    resize: string;
    flipHorizontal: string;
    flipVertical: string;
    /** The size control and its three sizes, small to large. */
    size: string;
    sizes: readonly [string, string, string];
    /** The Little Eraser's round and square tips. */
    eraserTips: readonly [string, string];
    font: string;
    fontSize: string;
    bold: string;
    italic: string;
    underline: string;
    aligns: readonly [string, string, string];
    readAloud: string;
    voice: string;
  };
}

/**
 * A sticker just put down, or a picture just brought in: it can still be moved, sized and
 * flipped, and becomes paint when it is let go. Layer px.
 */
interface FloatingSticker {
  name: string;
  picture: KidPixPicture;
  x: number;
  y: number;
  width: number;
  height: number;
  flipX: boolean;
  flipY: boolean;
}

/**
 * The tray's own controls, as Kid Pix draws them. Each is cut from a sheet with three states
 * side by side; `states` gives a button the three as CSS variables for kidpix.css to pick from.
 */
const states = (rest: string, chosen: string, hover: string) =>
  ({ "--kp-rest": rest, "--kp-chosen": chosen, "--kp-hover": hover }) as CSSProperties;

/** The size control's three balls: where each sits on its panel, and its size (assets/sizes.png). */
const SIZE_BALLS = [
  [34, 8, 12, 11],
  [32, 21, 16, 16],
  [28, 39, 25, 24],
] as const;
/** The mode buttons' rows in assets/modes.png: the brush's two, then the can's. */
const MODE_ROWS = { brush: [0, 1], spray: [2, 3] } as const;
const MODE_NAMES = { brush: ["Realistic", "Wacky"], spray: ["3D Shapes", "Moving Paint"] } as const;
const ALIGNS = ["left", "center", "right"] as const;
/** An option's cell in the tray's one row, with its gap, and the room the controls before the options take. */
const OPTION_CELL = 52;
const SIZES_ROOM = 73;
const MODES_ROOM = 60;
/** The text box's padding and border, in CSS px, so its letters sit where they will be painted. */
const TEXT_PAD = 5;

/** The library tools pick a category first; the tray then shows what is in it. */
type LibraryTool = "stamp" | "sticker" | "background";
const isLibraryTool = (tool: KidPixTool): tool is LibraryTool => tool === "stamp" || tool === "sticker" || tool === "background";

/** The library's files, copied to the site root from public/kidpix. */
const LIBRARY_URL = `${import.meta.env.BASE_URL}kidpix/`;

/** Stamps open on the alphabet, which is art from the main archives; the stamp libraries follow. */
const STAMP_CATEGORIES = [{ slug: "", name: "ABC" }, ...KIDPIX_STAMPS];
const CATEGORIES: Record<LibraryTool, readonly { slug: string; name: string }[]> = {
  stamp: STAMP_CATEGORIES,
  sticker: KIDPIX_STICKERS,
  background: KIDPIX_BACKGROUNDS,
};

/** A sticker's picture for the tray, fitted into a square. */
const STICKER_THUMB = 80;
const stickerThumb = (picture: SwfPicture) => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = STICKER_THUMB;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const scale = Math.min(STICKER_THUMB / picture.width, STICKER_THUMB / picture.height);
  ctx.translate((STICKER_THUMB - picture.width * scale) / 2, (STICKER_THUMB - picture.height * scale) / 2);
  ctx.scale(scale, scale);
  picture.draw(ctx);
  return canvas.toDataURL();
};

interface Option {
  index: number;
  label: string;
  content:
    | { sheet: string; cell: number; cells: number; tint?: string }
    | { url: string; cell: number; cells: number; pixelated?: boolean }
    | { style: CSSProperties; className: string; text?: string };
}

const sprite = (sheet: string, cell: number, cells: number, index: number, label: string): Option => ({
  index,
  label,
  content: { sheet, cell, cells },
});

const strip = (url: string, cells: number, index: number, label: string, cell = index, pixelated = false): Option => ({
  index,
  label,
  content: { url, cell, cells, pixelated },
});

const optionsFor = (
  tool: KidPixTool,
  spraying: boolean,
  brushMode: number,
  sprayMode: number,
  bucketKind: number,
  color: string,
  category: number,
  stickerThumbs: readonly string[],
  noBackground: string,
  tipLabels: readonly string[],
): Option[] => {
  switch (tool) {
    case "pencil":
      return PENCIL_SHAPES.map((shape, index) => sprite("shapes", index, PENCIL_SHAPES.length, index, shape.name));
    case "wacky":
      // The can holds 3D shapes or moving paint; an option keeps its place in the whole list of sets.
      if (spraying)
        return KIDPIX_SPRAY_SETS.flatMap((set, index) =>
          (set.kind === "moving") === (sprayMode === 1) ? [sprite("spray", index, KIDPIX_SPRAY_SETS.length, index, set.name)] : [],
        );
      // Realistic is brushes 0 to 19, which have no color of their own and show in the one in hand; Wacky is the rest.
      return Array.from({ length: brushMode === 0 ? REALISTIC_COUNT : BRUSH_COUNT - REALISTIC_COUNT }, (_, at) => {
        const index = brushMode === 0 ? at : at + REALISTIC_COUNT;
        const option = sprite("brushes", index, 57, index, toolLabel(index));
        return brushMode === 0 ? { ...option, content: { sheet: "brushes", cell: index, cells: 57, tint: color } } : option;
      });
    case "paint":
      // Solid: the color in hand, plain or through a one-color pattern. Blend and Pattern bring their own colors.
      if (bucketKind === 0)
        return Array.from({ length: SOLID_COUNT }, (_, index) => ({
          index,
          label: index === 0 ? "Color" : `Color Pattern ${index}`,
          content: { sheet: "solids", cell: index, cells: SOLID_COUNT, tint: color },
        }));
      if (bucketKind === 1)
        return Array.from({ length: GRADIENT_COUNT }, (_, index) =>
          sprite("gradients", index, GRADIENT_COUNT, index, `Blend ${index + 1}`),
        );
      return Array.from({ length: PATTERN_COUNT }, (_, index) => sprite("patterns", index, PATTERN_COUNT, index, `Pattern ${index + 1}`));
    case "mixer":
      return Array.from({ length: MIXER_COUNT + WAND_COUNT }, (_, index) =>
        sprite(
          "mixers",
          index,
          MIXER_COUNT + WAND_COUNT,
          index,
          toolLabel(index < MIXER_COUNT ? TOOL_NUMBER.firstMixer + index : TOOL_NUMBER.firstWand + index - MIXER_COUNT),
        ),
      );
    case "eraser":
      return [
        // The Little Eraser's two tips, then the Big Eraser's effects.
        ...tipLabels.map((label, index) => ({
          index,
          label,
          content: { className: "kidpix-block", style: { width: 24, height: 24, borderRadius: index === 0 ? "50%" : 0 } },
        })),
        ...Array.from({ length: SCREEN_ERASER_COUNT }, (_, index) =>
          sprite("erasers", index, SCREEN_ERASER_COUNT, index + ERASER_TIPS, toolLabel(TOOL_NUMBER.firstScreenEraser + index)),
        ),
      ];
    case "stamp": {
      if (category === 0)
        return Array.from({ length: 26 }, (_, index) => sprite("letters", index, 26, index, String.fromCharCode(65 + index)));
      const { slug, name, count } = KIDPIX_STAMPS[category - 1];
      return Array.from({ length: count }, (_, index) =>
        strip(`${LIBRARY_URL}stamps/${slug}.png`, count, index, `${name} ${index + 1}`, index, true),
      );
    }
    case "sticker":
      return KIDPIX_STICKERS[category].items.map(([name], index) => strip(stickerThumbs[index] ?? "", 1, index, name, 0));
    case "background": {
      const { slug, items } = KIDPIX_BACKGROUNDS[category];
      return [
        { index: 0, label: noBackground, content: { className: "kidpix-block", style: { width: 30, height: 30 } } },
        ...items.map((name, index) => strip(`${LIBRARY_URL}backgrounds/${slug}.jpg`, items.length, index + 1, name, index)),
      ];
    }
    case "text":
      // The text tray is controls, not options.
      return [];
    case "move":
      return [];
  }
};

/** Kid Pix steps a tube button's animation about nine times a second, as it does the tray's. */
const TOOL_STEP_MS = 110;

/** The Firecracker's "pointed at" script (Easel.MHK 1079) in frames of assets/dynamite.png, and its lit frame. */
const FUSE_SCRIPT = [2, 3, 4, 3, 2, 3, 4, 3, 4, 2, 3, 4, 3, 2, 3, 4] as const;
const FUSE_LIT = 1;
/** The original waits this long between the click and the first ring (ms). */
const FUSE_BURN_MS = 1500;
/** The Firecracker eraser's clip, and its rings: 20 px bands, one more a step, from this far down the paper on show. */
const FIRECRACKER_CLIP = 7219;
const RING_BAND = 20;
const RING_CENTER = 0.895;
/** The Big Eraser's effects that are those rings: Firecracker and Explode, by their place among its sixteen. */
const RING_ERASERS: ReadonlySet<number> = new Set([0, 10]);

/** Where a moving paint set keeps its clips. */
const spraySounds = (set: number) => `${LIBRARY_URL}spray/${KIDPIX_SPRAY_SETS[set].file}.m4a`;
/** A tap of the can is silent in Kid Pix; the hiss starts once it is held this long (ms). */
const SPRAY_HISS_DELAY = 150;
/** Moving paint's clips start no closer together than this (ms). */
const SPRAY_CLIP_GAP = 350;
/** Kid Pix's first twenty brushes are its Realistic ones. */

/** A picture file as something the layer can draw; the browser turns a photo upright by its EXIF. */
const readPicture = async (file: Blob): Promise<KidPixPicture> => {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return { width: bitmap.width, height: bitmap.height, draw: (ctx) => ctx.drawImage(bitmap, 0, 0) };
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight, draw: (ctx) => ctx.drawImage(image, 0, 0) };
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** A picture brought in fills at most this much of the paper, and several step apart by this many px. */
const PICTURE_FIT = 0.7;
const PICTURE_CASCADE = 28;

const loadImage = (url: string) => {
  const image = new Image();
  image.src = url;
  return image;
};

/**
 * Kid Pix mode: a paint layer over the drawing, in the chrome of Kid Pix Deluxe 4 (the tool
 * tube, the options tray, the color wheel and Undo Guy), with its sounds. The sheet around
 * it keeps Cancel and Done, and adds the paint to the drawing when the mode ends.
 */
const KidPixLayer = ({ ref, view, paper, muted, compact, backdropSources, labels }: KidPixLayerProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const backgroundRef = useRef<HTMLCanvasElement>(null);
  // What the library tools have fetched, by category: stamp strips, sticker pictures, backgrounds.
  const libraryRef = useRef({
    stamps: new Map<number, HTMLImageElement>(),
    stickers: new Map<number, SwfPicture[]>(),
    backgrounds: new Map<string, HTMLImageElement>(),
    sprays: new Map<number, HTMLImageElement>(),
  });
  const optionsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // For measuring a text box's lines, and the last text pressed in, for Read Aloud.
  const measureRef = useRef<CanvasRenderingContext2D | null>(null);
  const lastTextRef = useRef("");
  const engineRef = useRef<KidPixEngine | null>(null);
  const audioRef = useRef<KidPixAudio | null>(null);
  const timersRef = useRef<{ tool?: number; hover?: number; guy?: number; boom?: number; fuse?: number }>({});
  // The Spray Can's sound while it is held: the hiss waiting to start or looping, and when the next clip may play.
  const sprayRef = useRef<{ hiss?: number; loop: AudioBufferSourceNode | null; quietUntil: number }>({ loop: null, quietUntil: 0 });
  const frameRef = useRef<HTMLDivElement>(null);
  const floatingCanvasRef = useRef<HTMLCanvasElement>(null);
  // The sticker in its frame, mirrored in a ref for the handlers that flatten it.
  const floatingRef = useRef<FloatingSticker | null>(null);
  const dragRef = useRef<{ mode: "move" | "nw" | "se"; x: number; y: number; from: FloatingSticker } | null>(null);
  const backdropRef = useRef(backdropSources);
  const [tool, setTool] = useState<KidPixTool>("wacky");
  const [chosen, setChosen] = useState<Record<KidPixTool, number>>({
    pencil: 1,
    wacky: 40,
    paint: 0,
    mixer: 0,
    eraser: 1,
    stamp: 0,
    text: 0,
    move: 0,
    sticker: 0,
    background: 0,
  });
  const [category, setCategory] = useState<Record<LibraryTool, number>>({ stamp: 0, sticker: 0, background: 0 });
  // The tray pictures of the sticker category on show, drawn once its file has arrived.
  const [stickerThumbs, setStickerThumbs] = useState<{ category: number; urls: string[] }>({ category: -1, urls: [] });
  const [pencilKind, setPencilKind] = useState(0);
  const [pencilShape, setPencilShape] = useState(0);
  // The Fill Bucket in hand (solid, blend, pattern) and the fill each one last used.
  const [bucketKind, setBucketKind] = useState(0);
  const [bucketChoice, setBucketChoice] = useState<readonly number[]>([0, 0, 0]);
  const [floating, setFloating] = useState<FloatingSticker | null>(null);
  // The brush zone's kind (0 the paint brush, 1 the Spray Can) and the picture set in the can.
  const [brushKind, setBrushKind] = useState(0);
  const spraying = tool === "wacky" && brushKind === 1;
  // The brush's mode (0 Realistic, 1 Wacky), its size, and the brush each mode last used.
  const [brushMode, setBrushMode] = useState(1);
  const [brushSize, setBrushSize] = useState(1);
  // The mixer wand starts at its smallest, as Kid Pix's does.
  const [wandSize, setWandSize] = useState(0);
  const [eraserSize, setEraserSize] = useState(2);
  const [brushChoice, setBrushChoice] = useState<readonly number[]>([0, 40]);
  // The can's mode (0 3D shapes, 1 moving paint) and the set each last used, counted through all the sets.
  const [sprayMode, setSprayMode] = useState(0);
  const [sprayChoice, setSprayChoice] = useState<readonly number[]>([0, KIDPIX_SPRAY_SETS.findIndex((set) => set.kind === "moving")]);
  const spraySet = sprayChoice[sprayMode];
  // The text box being typed, and how its letters look.
  const [draft, setDraft] = useState("");
  const [draftWidth, setDraftWidth] = useState(0);
  const [textSize, setTextSize] = useState<number>(TEXT_SIZE);
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [underline, setUnderline] = useState(false);
  const [align, setAlign] = useState<TextStyle["align"]>("left");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState("");
  // The tray shows one row of options, a page at a time; the page belongs to the options on show.
  const [optionsWidth, setOptionsWidth] = useState(0);
  const [paging, setPaging] = useState({ key: "", page: 0 });
  const [color, setColor] = useState("#ff0080");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [typing, setTyping] = useState<Point | null>(null);
  // The chosen tool's button flashes its lit frame, then rests like the others.
  const [toolFrame, setToolFrame] = useState(0);
  // A tool pointed at with a mouse runs its animation for as long as the pointer stays on it.
  const [hovering, setHovering] = useState<{ key: KidPixTool; frame: number } | null>(null);
  const [guyFrame, setGuyFrame] = useState(UNDO_GUY_REST);
  // The Firecracker's frame (assets/dynamite.png) while it sparks or is lit, and how far its rings have spread.
  const [fuse, setFuse] = useState<number | null>(null);
  const [rings, setRings] = useState<{ spread: number; x: number; y: number } | null>(null);
  const [splash, setSplash] = useState(true);

  // The layer is as large as the view in drawing px, so its paint lands on the drawing 1:1.
  const width = Math.max(1, Math.round(view.width / view.zoom));
  const height = Math.max(1, Math.round(view.height / view.zoom));

  useEffect(() => {
    backdropRef.current = backdropSources;
  }, [backdropSources]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const backgroundCanvas = backgroundRef.current;
    if (!canvas || !backgroundCanvas) return;
    const timers = timersRef.current;
    const audio = new KidPixAudio(soundsUrl);
    const images: KidPixImages = {
      fills: loadImage(fillsUrl),
      solidTiles: loadImage(solidTilesUrl),
      gradients: loadImage(gradientsUrl),
      letters: loadImage(lettersUrl),
      tips: loadImage(tipsUrl),
      brushParts: loadImage(brushPartsUrl),
      brushWindow: loadImage(brushWindowUrl),
    };
    audioRef.current = audio;
    engineRef.current = new KidPixEngine(canvas, {
      paper,
      backgroundCanvas,
      backdropSources: () => backdropRef.current(),
      images,
      audio,
      fontFamily: FONTS[0].family,
    });
    // The canvas has no pixels until its fonts load; ask for them before the first text.
    for (const font of FONTS) document.fonts?.load(`${TEXT_SIZE}px ${font.family}`).catch(() => undefined);
    // Keys belong to this mode now, not to the drawing's shortcuts.
    rootRef.current?.focus();
    const opened = performance.now();
    audio.ready.then(() => {
      // The startup jingle greets the mode, unless the sprite took too long to arrive.
      if (performance.now() - opened < 1500) audio.play("splash1000");
    });
    const splashTimer = window.setTimeout(() => setSplash(false), 1300);
    return () => {
      window.clearTimeout(splashTimer);
      window.clearInterval(timers.tool);
      window.clearInterval(timers.hover);
      window.clearInterval(timers.guy);
      window.clearInterval(timers.boom);
      window.clearInterval(timers.fuse);
      // Lifts the pointer, so a Spray Can still spraying stops.
      window.clearTimeout(sprayRef.current.hiss);
      engineRef.current?.up();
      audio.dispose();
      engineRef.current = null;
      audioRef.current = null;
    };
    // The paper and the layer's size are fixed for a session: the mode remounts to change them.
  }, [paper]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
    if (muted) audioRef.current?.silenceLoop();
  }, [muted]);

  useEffect(() => {
    if (typing) inputRef.current?.focus();
  }, [typing]);

  // How many options fit the tray's one row depends on how wide the sheet is.
  useEffect(() => {
    const strip = optionsRef.current;
    if (!strip || compact || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setOptionsWidth(strip.clientWidth));
    observer.observe(strip);
    setOptionsWidth(strip.clientWidth);
    return () => observer.disconnect();
  }, [compact]);

  // A sticker category is one file of Flash pictures; fetch and read it when it first shows.
  const stickerCategory = tool === "sticker" ? category.sticker : -1;
  useEffect(() => {
    if (stickerCategory < 0) return;
    const library = libraryRef.current;
    let current = true;
    const show = (pictures: SwfPicture[]) => {
      if (current) setStickerThumbs({ category: stickerCategory, urls: pictures.map(stickerThumb) });
    };
    const known = library.stickers.get(stickerCategory);
    if (known) {
      show(known);
      return;
    }
    const { slug, items } = KIDPIX_STICKERS[stickerCategory];
    fetch(`${LIBRARY_URL}stickers/${slug}.bin`)
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(response.statusText))))
      .then((bytes) => {
        const pictures = readStickers(
          new Uint8Array(bytes),
          items.map(([, length]) => length),
        );
        library.stickers.set(stickerCategory, pictures);
        show(pictures);
      })
      // The tray stays empty; the other tools are unaffected.
      .catch((error) => console.error(error));
    return () => {
      current = false;
    };
  }, [stickerCategory]);

  const float = (next: FloatingSticker | null) => {
    floatingRef.current = next;
    setFloating(next);
  };

  /** Presses the sticker in its frame into the paint, as it lies. */
  const flattenSticker = () => {
    const sticker = floatingRef.current;
    if (!sticker) return;
    float(null);
    engineRef.current?.sticker(sticker.picture, sticker, sticker.flipX, sticker.flipY);
  };

  const addPictures = async (files: readonly File[]) => {
    commitText();
    engineRef.current?.settle();
    let failed = 0;
    let placed = 0;
    for (const file of files) {
      let picture: KidPixPicture;
      try {
        picture = await readPicture(file);
      } catch {
        failed++;
        continue;
      }
      if (!picture.width || !picture.height) {
        failed++;
        continue;
      }
      // Only one thing is loose at a time: the picture before this one becomes paint where it lies.
      flattenSticker();
      const fit = Math.min(1, (width * PICTURE_FIT) / picture.width, (height * PICTURE_FIT) / picture.height);
      const pictureWidth = Math.max(1, Math.round(picture.width * fit));
      const pictureHeight = Math.max(1, Math.round(picture.height * fit));
      const offset = (placed - (files.length - 1) / 2) * PICTURE_CASCADE;
      float({
        name: file.name,
        picture,
        x: Math.round((width - pictureWidth) / 2 + offset),
        y: Math.round((height - pictureHeight) / 2 + offset),
        width: pictureWidth,
        height: pictureHeight,
        flipX: false,
        flipY: false,
      });
      placed++;
    }
    if (placed > 0) {
      play("misc31501");
      requestAnimationFrame(() => frameRef.current?.focus());
    }
    return failed;
  };

  useImperativeHandle(ref, () => ({
    addPictures,
    hasPaint: () => Boolean(floatingRef.current) || Boolean(typing && draft.trim()) || Boolean(engineRef.current?.hasPaint()),
    takeTiles: (maxSide) => {
      commitText();
      flattenSticker();
      return engineRef.current?.takeTiles(maxSide) ?? Promise.resolve([]);
    },
  }));

  // The sticker in its frame is drawn fresh at the size it has been pulled to, so it stays sharp.
  useEffect(() => {
    const canvas = floatingCanvasRef.current;
    if (!canvas || !floating) return;
    const scale = view.zoom * (window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(floating.width * scale));
    canvas.height = Math.max(1, Math.round(floating.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.translate(floating.flipX ? canvas.width : 0, floating.flipY ? canvas.height : 0);
    ctx.scale(
      ((floating.flipX ? -1 : 1) * canvas.width) / floating.picture.width,
      ((floating.flipY ? -1 : 1) * canvas.height) / floating.picture.height,
    );
    floating.picture.draw(ctx);
  }, [floating, view.zoom]);

  const play = (clip: string, volume?: number) => {
    audioRef.current?.wake();
    audioRef.current?.play(clip, { volume });
  };

  const textStyle: TextStyle = { family: FONTS[chosen.text].family, size: textSize, bold, italic, underline, align };

  /** Presses the text box into the paint, as it reads. */
  const commitText = () => {
    if (!typing) return;
    if (draft.trim()) lastTextRef.current = draft;
    engineRef.current?.text(typing, draft, textStyle);
    setTyping(null);
    setDraft("");
  };

  // The box is as wide as its longest line, measured in the font it will be painted in.
  const textFontNow = textFont(textStyle);
  useEffect(() => {
    measureRef.current ??= document.createElement("canvas").getContext("2d");
    const ctx = measureRef.current;
    if (!ctx) return;
    ctx.font = textFontNow;
    setDraftWidth(Math.max(...draft.split("\n").map((line) => ctx.measureText(line).width)));
  }, [draft, textFontNow]);

  // Read Aloud speaks with the browser's voices, where it has any; they can arrive late.
  useEffect(() => {
    const speech = window.speechSynthesis;
    if (!speech) return;
    const load = () => setVoices(speech.getVoices());
    load();
    speech.addEventListener?.("voiceschanged", load);
    return () => {
      speech.removeEventListener?.("voiceschanged", load);
      speech.cancel();
    };
  }, []);

  /** Reads the text box out, or the last one pressed in when none is open. */
  const readAloud = () => {
    const speech = window.speechSynthesis;
    const words = draft.trim() || lastTextRef.current.trim();
    if (!speech || !words) return;
    speech.cancel();
    const utterance = new SpeechSynthesisUtterance(words);
    const voice = voices.find((candidate) => candidate.name === voiceName);
    if (voice) utterance.voice = voice;
    speech.speak(utterance);
  };

  /** Whatever is half-done is finished or dropped before the tray changes under it. */
  const settle = () => {
    commitText();
    flattenSticker();
    engineRef.current?.settle();
  };

  const stopHover = () => {
    window.clearInterval(timersRef.current.hover);
    setHovering(null);
  };
  /**
   * Kid Pix loops a tool button's hover script while the pointer is on it, a step about nine
   * times a second: its frames in the script's order, and the tool's own clip on every pass.
   */
  const startHover = (item: (typeof TUBE_TOOLS)[number]) => {
    window.clearInterval(timersRef.current.hover);
    let at = 0;
    const step = () => {
      // A clip starts with the frame after it, so the two take one step together.
      while (item.hover[at] === "clip") {
        play(item.hoverSound);
        at = (at + 1) % item.hover.length;
      }
      setHovering({ key: item.key, frame: item.hover[at] as number });
      at = (at + 1) % item.hover.length;
    };
    step();
    timersRef.current.hover = window.setInterval(step, TOOL_STEP_MS);
  };

  const chooseTool = (next: (typeof TUBE_TOOLS)[number]) => {
    settle();
    stopHover();
    setPaletteOpen(false);
    const before = TUBE_TOOLS.find((item) => item.key === tool);
    setTool(next.key);
    // The chosen button's script flashes its lit frame for one step; the button it replaces plays its own clip as it rests.
    play(next.selectSound);
    if (before?.restSound && before.key !== next.key) play(before.restSound);
    let steps = 0;
    window.clearInterval(timersRef.current.tool);
    setToolFrame(0);
    timersRef.current.tool = window.setInterval(() => {
      steps++;
      setToolFrame(steps === 1 ? next.frames - 1 : 0);
      if (steps > 1) window.clearInterval(timersRef.current.tool);
    }, TOOL_STEP_MS);
  };

  /** The strip of rubber stamps for a stamp category, fetched on first use. */
  const stampSheet = (stampCategory: number) => {
    const sheets = libraryRef.current.stamps;
    let sheet = sheets.get(stampCategory);
    if (!sheet && stampCategory > 0) {
      sheet = loadImage(`${LIBRARY_URL}stamps/${KIDPIX_STAMPS[stampCategory - 1].slug}.png`);
      sheets.set(stampCategory, sheet);
    }
    return sheet;
  };

  /** The sheet of pictures for a spray set, fetched on first use. */
  const spraySheet = (set: number) => {
    const sheets = libraryRef.current.sprays;
    let sheet = sheets.get(set);
    if (!sheet) {
      sheet = loadImage(`${LIBRARY_URL}spray/${KIDPIX_SPRAY_SETS[set].file}.png`);
      sheets.set(set, sheet);
    }
    // Moving paint brings its own clips, a file per set.
    if (KIDPIX_SPRAY_SETS[set].clips) audioRef.current?.load(spraySounds(set));
    return sheet;
  };

  /**
   * The can's sound, as Kid Pix plays it. 3D shapes hiss (clip 7200) for as long as the can is
   * held, though not for a single tap. Moving paint has each animation's own clip; at nine
   * pictures a second they would pile up, so a new one waits for the last to get going.
   */
  const startSpraySound = (set: number) => {
    const { clips } = KIDPIX_SPRAY_SETS[set];
    const spray = sprayRef.current;
    window.clearTimeout(spray.hiss);
    if (clips) {
      spray.hiss = undefined;
      return (frame: readonly number[]) => {
        const clip = clips[frame[6]];
        const now = performance.now();
        if (!clip || now < spray.quietUntil) return;
        spray.quietUntil = now + Math.min(clip[1] * 1000, SPRAY_CLIP_GAP);
        audioRef.current?.playFrom(spraySounds(set), clip[0], clip[1]);
      };
    }
    spray.hiss = window.setTimeout(() => {
      spray.loop = audioRef.current?.play("w7200", { loop: true }) ?? null;
    }, SPRAY_HISS_DELAY);
    return undefined;
  };

  const stopSpraySound = () => {
    const spray = sprayRef.current;
    window.clearTimeout(spray.hiss);
    try {
      spray.loop?.stop();
    } catch {
      // Already stopped.
    }
    spray.loop = null;
  };

  const liftPointer = () => {
    stopSpraySound();
    engineRef.current?.up();
  };

  /** A background takes effect when picked: 0 is none, the rest are the category's pictures. */
  const chooseBackground = (index: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    if (index === 0) {
      engine.setBackground(null);
      return;
    }
    const url = `${LIBRARY_URL}backgrounds/${KIDPIX_BACKGROUNDS[category.background].slug}/${index - 1}.jpg`;
    const backgrounds = libraryRef.current.backgrounds;
    const known = backgrounds.get(url);
    if (known?.complete) {
      engine.setBackground(known);
      return;
    }
    const image = known ?? loadImage(url);
    backgrounds.set(url, image);
    image.addEventListener("load", () => engineRef.current?.setBackground(image), { once: true });
  };

  const chooseOption = (index: number) => {
    audioRef.current?.wake();
    settle();
    if (tool === "pencil") {
      setPencilShape(index);
      play("easel1029");
      return;
    }
    if (tool === "paint") {
      setBucketChoice((previous) => previous.map((choice, kind) => (kind === bucketKind ? index : choice)));
      play("easel1029");
      return;
    }
    if (spraying) {
      setSprayChoice((previous) => previous.map((choice, mode) => (mode === sprayMode ? index : choice)));
      // Fetched now, so the can is full by the time it is pointed at the paper.
      spraySheet(index);
      play("easel1029");
      return;
    }
    if (tool === "wacky") {
      setBrushChoice((previous) => previous.map((choice, mode) => (mode === brushMode ? index : choice)));
      play("easel1029");
      return;
    }
    setChosen((previous) => ({ ...previous, [tool]: index }));
    if (tool === "background") {
      chooseBackground(index);
      return;
    }
    // A letter says its name, as Kid Pix's alphabet panel does; other trays click.
    play(tool === "stamp" && category.stamp === 0 ? `letter${String.fromCharCode(65 + index)}` : "easel1029");
  };

  const chooseCategory = (next: number) => {
    if (!isLibraryTool(tool)) return;
    setCategory((previous) => ({ ...previous, [tool]: next }));
    setChosen((previous) => ({ ...previous, [tool]: 0 }));
    if (tool === "stamp") stampSheet(next);
    optionsRef.current?.scrollTo({ left: 0 });
    play("easel1029");
  };

  const chooseColor = (next: string) => {
    setColor(next);
    setPaletteOpen(false);
    if (engineRef.current) engineRef.current.color = next;
    play("misc31504");
  };

  const pointOf = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - box.left) * width) / box.width, y: ((event.clientY - box.top) * height) / box.height };
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current;
    if (!engine || event.button !== 0) return;
    audioRef.current?.wake();
    setPaletteOpen(false);
    if (typing) {
      commitText();
      return;
    }
    const at = pointOf(event);
    const option = chosen[tool];
    if (floatingRef.current) {
      // A press on the paper lets the sticker go; with the Stickers tool it also puts down the next.
      flattenSticker();
      if (tool !== "sticker") return;
    }
    if (tool === "sticker") {
      const picture = libraryRef.current.stickers.get(category.sticker)?.[option];
      if (!picture) return;
      float({
        name: KIDPIX_STICKERS[category.sticker].items[option]?.[0] ?? current.name,
        picture,
        x: Math.round(at.x - picture.width / 2),
        y: Math.round(at.y - picture.height / 2),
        width: picture.width,
        height: picture.height,
        flipX: false,
        flipY: false,
      });
      play("misc31501");
      // The new sticker takes the keys, so Delete and the arrows reach it.
      requestAnimationFrame(() => frameRef.current?.focus());
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "pencil") engine.shapeDown(at, pencilShape, chosen.pencil, pencilKind);
    else if (spraying) engine.sprayDown(at, spraySheet(spraySet), KIDPIX_SPRAY_SETS[spraySet].frames, startSpraySound(spraySet));
    else if (tool === "wacky") engine.brushDown(at, brushChoice[brushMode], brushSize);
    else if (tool === "paint") engine.fill(at, bucketKind, bucketChoice[bucketKind]);
    else if (tool === "mixer") {
      if (option < MIXER_COUNT) engine.mix(option);
      else engine.wandDown(at, option - MIXER_COUNT, wandSize);
    } else if (tool === "eraser") {
      const effect = option - ERASER_TIPS;
      if (option < ERASER_TIPS) engine.eraserDown(at, eraserSize, option === 0);
      else if (RING_ERASERS.has(effect)) {
        // Firecracker and Explode: the rings spread from where the paper was clicked.
        const box = rootRef.current?.getBoundingClientRect();
        if (box && timersRef.current.boom === undefined) {
          play(`w${KIDPIX_TOOL_SOUNDS[TOOL_NUMBER.firstScreenEraser + effect]?.[0] ?? FIRECRACKER_CLIP}`);
          spreadRings(event.clientX - box.left, event.clientY - box.top);
        }
      } else engine.wipe(effect);
    } else if (tool === "stamp") {
      const sheet = stampSheet(category.stamp);
      if (sheet) engine.stampFrom(at, sheet, option);
      else engine.stamp(at, option);
    } else if (tool === "text") {
      // The press is the middle of the first line; the box grows right and down from there.
      setDraft("");
      setTyping({ x: at.x, y: at.y - (textSize * TEXT_LINE) / 2 });
    } else if (tool === "move") engine.moveDown(at);
  };

  const handleTextKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter starts a new line, as in Kid Pix; a press on the paper, or another tool, presses the text in.
    if (event.key === "Escape") {
      // Escape leaves the text, not the sheet.
      event.stopPropagation();
      event.nativeEvent.stopPropagation();
      setTyping(null);
      setDraft("");
    }
  };

  // Undo Guy takes back the last thing painted and says so. His mouth moves for as long as the line lasts.
  const undo = () => {
    commitText();
    // A sticker still in its frame is the last thing done: taking it back lifts it off again.
    if (floatingRef.current) float(null);
    else engineRef.current?.undo();
    const line = UNDO_GUY_LINES[Math.floor(Math.random() * UNDO_GUY_LINES.length)];
    play(line.clip);
    const length = (muted ? 0.6 : (audioRef.current?.duration(line.clip) ?? 0.6)) * 1000;
    const started = performance.now();
    window.clearInterval(timersRef.current.guy);
    timersRef.current.guy = window.setInterval(() => {
      const step = Math.floor(((performance.now() - started) / length) * line.frames.length);
      if (step >= line.frames.length) {
        window.clearInterval(timersRef.current.guy);
        setGuyFrame(UNDO_GUY_REST);
      } else {
        setGuyFrame(line.frames[step]);
      }
    }, 40);
  };

  // The Firecracker, as its button scripts and its eraser run in Kid Pix. Pointed at, its fuse sparks.
  const sparkFuse = () => {
    if (timersRef.current.boom !== undefined) return;
    window.clearInterval(timersRef.current.fuse);
    let at = 0;
    const step = () => {
      if (at === 0) play("easel1028");
      setFuse(FUSE_SCRIPT[at]);
      at = (at + 1) % FUSE_SCRIPT.length;
    };
    step();
    timersRef.current.fuse = window.setInterval(step, TOOL_STEP_MS);
  };
  const snuffFuse = () => {
    window.clearInterval(timersRef.current.fuse);
    if (timersRef.current.boom === undefined) setFuse(null);
  };
  // The Firecracker eraser's rings: they spread from a point until they have passed the paper's
  // far corners, and then every bit of Kid Pix paint is gone (Undo Guy can bring it back).
  const spreadRings = (x: number, y: number) => {
    const finish = () => {
      window.clearInterval(timersRef.current.boom);
      timersRef.current.boom = undefined;
      engineRef.current?.clear();
      setRings(null);
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    const reach = Math.max(
      Math.hypot(x, y),
      Math.hypot(view.width - x, y),
      Math.hypot(x, view.height - y),
      Math.hypot(view.width - x, view.height - y),
    );
    let spread = RING_BAND;
    setRings({ spread, x, y });
    timersRef.current.boom = window.setInterval(() => {
      spread += RING_BAND;
      if (spread > reach + RING_BAND) finish();
      else setRings({ spread, x, y });
    }, TOOL_STEP_MS);
  };
  // Clicked, the tube's Firecracker lights; a moment later its rings spread from the foot of the paper.
  const dynamite = () => {
    if (timersRef.current.boom !== undefined) return;
    commitText();
    float(null);
    engineRef.current?.settle();
    window.clearInterval(timersRef.current.fuse);
    play("easel1027");
    setFuse(FUSE_LIT);
    timersRef.current.boom = window.setTimeout(() => {
      setFuse(null);
      play(`w${FIRECRACKER_CLIP}`);
      // The rings start near the foot of the paper that shows above the tray.
      const root = rootRef.current;
      const chrome = root?.querySelector(".kidpix-tray, .kidpix-panel");
      const foot = root && chrome ? chrome.getBoundingClientRect().top - root.getBoundingClientRect().top : view.height;
      timersRef.current.boom = undefined;
      spreadRings(view.width / 2, foot * RING_CENTER);
    }, FUSE_BURN_MS);
  };

  const current = TUBE_TOOLS.find((item) => item.key === tool) ?? TUBE_TOOLS[0];
  const toolCategory = isLibraryTool(tool) ? category[tool] : 0;
  const options = optionsFor(
    tool,
    spraying,
    brushMode,
    sprayMode,
    bucketKind,
    color,
    toolCategory,
    stickerThumbs.category === category.sticker ? stickerThumbs.urls : [],
    labels.noBackground,
    labels.eraserTips,
  );

  const toolButtons = TUBE_TOOLS.map((item) => {
    const selected = item.key === tool;
    const frame = selected ? toolFrame : hovering?.key === item.key ? hovering.frame : 0;
    return (
      <button
        key={item.key}
        type="button"
        className="kidpix-tool mu-focus"
        aria-label={item.name}
        aria-pressed={selected}
        title={item.name}
        onClick={() => chooseTool(item)}
        onPointerEnter={(event) => {
          if (selected || event.pointerType !== "mouse") return;
          startHover(item);
        }}
        onPointerLeave={() => {
          if (hovering?.key === item.key) stopHover();
        }}
      >
        <span aria-hidden className="kidpix-tool-art" style={{ backgroundPosition: `-${frame * 58}px -${item.row * 60}px` }} />
      </button>
    );
  });

  // Which option is in hand: the Pencil has a size and a shape, the can a set, each bucket its own fill.
  const pressedOption = (index: number) => {
    if (tool === "background") return false;
    if (tool === "pencil") return pencilShape === index;
    if (spraying) return spraySet === index;
    if (tool === "wacky") return brushChoice[brushMode] === index;
    if (tool === "paint") return bucketChoice[bucketKind] === index;
    return chosen[tool] === index;
  };

  // The sticker's frame: drag inside to move it, a Scale corner to size it; the other two corners flip it.
  const dragStart = (mode: "move" | "nw" | "se") => (event: PointerEvent<HTMLElement>) => {
    const from = floatingRef.current;
    if (!from || event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { mode, x: event.clientX, y: event.clientY, from };
  };
  const dragMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { from, mode } = drag;
    const dx = (event.clientX - drag.x) / view.zoom;
    const dy = (event.clientY - drag.y) / view.zoom;
    if (mode === "move") {
      float({ ...from, x: from.x + dx, y: from.y + dy });
      return;
    }
    // A Scale corner keeps the sticker's shape and holds the opposite corner still.
    const aspect = from.height / from.width;
    const pull = mode === "se" ? Math.max(dx, dy / aspect) : Math.max(-dx, -dy / aspect);
    const stickerWidth = Math.max(16, Math.min(width * 2, from.width + pull));
    const stickerHeight = stickerWidth * aspect;
    float({
      ...from,
      width: stickerWidth,
      height: stickerHeight,
      x: mode === "nw" ? from.x + from.width - stickerWidth : from.x,
      y: mode === "nw" ? from.y + from.height - stickerHeight : from.y,
    });
  };
  const dragEnd = () => {
    dragRef.current = null;
  };
  const handleFrameKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const sticker = floatingRef.current;
    if (!sticker || event.target !== event.currentTarget) return;
    const step = event.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (move) float({ ...sticker, x: sticker.x + move[0], y: sticker.y + move[1] });
    else if (event.key === "Delete" || event.key === "Backspace") float(null);
    else if (event.key === "Enter") flattenSticker();
    else if (event.key === "Escape") {
      // Escape takes the sticker off, not the sheet down.
      event.nativeEvent.stopPropagation();
      float(null);
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };
  const stickerFrame = floating && (
    <div
      ref={frameRef}
      role="group"
      tabIndex={0}
      aria-label={floating.name}
      className="kidpix-floating mu-focus"
      style={{
        left: floating.x * view.zoom,
        top: floating.y * view.zoom,
        width: floating.width * view.zoom,
        height: floating.height * view.zoom,
      }}
      onPointerDown={dragStart("move")}
      onPointerMove={dragMove}
      onPointerUp={dragEnd}
      onPointerCancel={dragEnd}
      onKeyDown={handleFrameKey}
    >
      <canvas ref={floatingCanvasRef} aria-hidden />
      {(["nw", "se"] as const).map((corner) => (
        <button
          key={corner}
          type="button"
          className="kidpix-handle mu-focus"
          data-corner={corner}
          aria-label={labels.resize}
          title={labels.resize}
          onPointerDown={dragStart(corner)}
          onPointerMove={dragMove}
          onPointerUp={dragEnd}
          onPointerCancel={dragEnd}
        />
      ))}
      <button
        type="button"
        className="kidpix-handle mu-focus"
        data-corner="ne"
        aria-label={labels.flipHorizontal}
        title={labels.flipHorizontal}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => floatingRef.current && float({ ...floatingRef.current, flipX: !floatingRef.current.flipX })}
      />
      <button
        type="button"
        className="kidpix-handle mu-focus"
        data-corner="sw"
        aria-label={labels.flipVertical}
        title={labels.flipVertical}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => floatingRef.current && float({ ...floatingRef.current, flipY: !floatingRef.current.flipY })}
      />
    </div>
  );

  // One row of options, as many as fit, a page at a time; a phone's strip scrolls through them all.
  const wanding = tool === "mixer" && chosen.mixer >= MIXER_COUNT;
  const rubbing = tool === "eraser" && chosen.eraser < ERASER_TIPS;
  const sizeValue = tool === "pencil" ? chosen.pencil : wanding ? wandSize : rubbing ? eraserSize : brushSize;
  const hasSizes = tool === "pencil" || (tool === "wacky" && !spraying) || wanding || rubbing;
  const modes = tool === "wacky" ? (spraying ? "spray" : "brush") : null;
  const modeValue = spraying ? sprayMode : brushMode;
  const optionsKey = [tool, modes, modeValue, bucketKind, toolCategory].join("/");
  const room = optionsWidth - (hasSizes ? SIZES_ROOM : 0) - (modes ? MODES_ROOM : 0);
  const perPage = compact || optionsWidth === 0 ? Math.max(1, options.length) : Math.max(1, Math.floor(room / OPTION_CELL));
  const pages = Math.max(1, Math.ceil(options.length / perPage));
  const chosenAt = Math.max(
    0,
    options.findIndex((option) => pressedOption(option.index)),
  );
  // A fresh set of options opens on the page with the one in hand.
  const page = Math.min(pages - 1, paging.key === optionsKey ? paging.page : Math.floor(chosenAt / perPage));
  const shownOptions = options.slice(page * perPage, (page + 1) * perPage);
  const turnPage = (direction: 1 | -1) => {
    // The pages go round: back from the first is the last, as in Kid Pix.
    setPaging({ key: optionsKey, page: (page + direction + pages) % pages });
    play("easel1029");
  };

  const chooseSize = (index: number) => {
    settle();
    if (tool === "pencil") setChosen((previous) => ({ ...previous, pencil: index }));
    else if (wanding) setWandSize(index);
    else if (rubbing) setEraserSize(index);
    else setBrushSize(index);
    play("easel1029");
  };
  const chooseMode = (index: number) => {
    settle();
    if (spraying) {
      setSprayMode(index);
      spraySheet(sprayChoice[index]);
    } else setBrushMode(index);
    play("easel1029");
  };
  // Kid Pix's size control: three balls, small to large, the one in hand lit.
  const sizesControl = hasSizes && (
    <div role="group" aria-label={labels.size} className="kidpix-sizes">
      {SIZE_BALLS.map(([x, y, ballWidth, ballHeight], index) => {
        const at = (state: number) => `-${67 + (index * 3 + state) * 26 + (26 - ballWidth) / 2}px -${(26 - ballHeight) / 2}px`;
        return (
          <button
            key={labels.sizes[index]}
            type="button"
            className="kidpix-sprite-button mu-focus"
            aria-label={labels.sizes[index]}
            aria-pressed={sizeValue === index}
            title={labels.sizes[index]}
            style={{ left: x, top: y, width: ballWidth, height: ballHeight, ...states(at(0), at(1), at(2)) }}
            onClick={() => chooseSize(index)}
          />
        );
      })}
    </div>
  );
  // Its two mode buttons: Realistic and Wacky for the brush, 3D Shapes and Moving Paint for the can.
  const modesControl = modes && (
    <div role="group" aria-label={current.name} className="kidpix-modes">
      {MODE_ROWS[modes].map((row, index) => (
        <button
          key={row}
          type="button"
          className="kidpix-sprite-button mu-focus"
          aria-label={MODE_NAMES[modes][index]}
          aria-pressed={modeValue === index}
          title={MODE_NAMES[modes][index]}
          style={states(`-108px -${row * 34}px`, `0 -${row * 34}px`, `-54px -${row * 34}px`)}
          onClick={() => chooseMode(index)}
        />
      ))}
    </div>
  );

  // The text tray: how the letters look, in the tray's first panel, and Read Aloud beside it.
  const keepTyping = (event: { target: EventTarget; preventDefault: () => void }) => {
    // A press on a button must not take the keys from the text box; a list needs them to open.
    if (!(event.target instanceof HTMLSelectElement)) event.preventDefault();
  };
  const textButton = (label: string, pressed: boolean, row: number, cell: number, toggle: () => void) => {
    const at = (state: number) => `-${(cell * 3 + state) * 28}px -${row * 34}px`;
    return (
      <button
        key={label}
        type="button"
        className="kidpix-sprite-button mu-focus"
        aria-label={label}
        aria-pressed={pressed}
        title={label}
        style={states(at(0), at(1), at(2))}
        onClick={toggle}
      />
    );
  };
  const textControls = tool === "text" && (
    <div className="kidpix-text-tools" onMouseDown={keepTyping}>
      <div>
        <select
          aria-label={labels.font}
          title={labels.font}
          className="mu-focus"
          value={chosen.text}
          style={{ fontFamily: FONTS[chosen.text].family }}
          onChange={(event) => {
            setChosen((previous) => ({ ...previous, text: Number(event.target.value) }));
            inputRef.current?.focus();
          }}
        >
          {FONTS.map((font, index) => (
            <option key={font.family} value={index} style={{ fontFamily: font.family }}>
              {font.name}
            </option>
          ))}
        </select>
        <select
          aria-label={labels.fontSize}
          title={labels.fontSize}
          className="mu-focus"
          value={textSize}
          onChange={(event) => {
            setTextSize(Number(event.target.value));
            inputRef.current?.focus();
          }}
        >
          {TEXT_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>
      <div className="kidpix-text-buttons">
        {textButton(labels.bold, bold, 0, 0, () => setBold(!bold))}
        {textButton(labels.italic, italic, 0, 1, () => setItalic(!italic))}
        {textButton(labels.underline, underline, 0, 2, () => setUnderline(!underline))}
        {ALIGNS.map((value, index) => textButton(labels.aligns[index], align === value, 1, index, () => setAlign(value)))}
      </div>
    </div>
  );
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;
  const readControls = tool === "text" && canSpeak && (
    <div className="kidpix-read" onMouseDown={keepTyping}>
      <button
        type="button"
        className="kidpix-sprite-button mu-focus"
        aria-label={labels.readAloud}
        title={labels.readAloud}
        onClick={readAloud}
      />
      {voices.length > 0 && (
        <select
          aria-label={labels.voice}
          title={labels.voice}
          className="mu-focus"
          value={voiceName}
          onChange={(event) => {
            setVoiceName(event.target.value);
            inputRef.current?.focus();
          }}
        >
          <option value="">{labels.voice}</option>
          {voices.map((voice) => (
            <option key={voice.name} value={voice.name}>
              {voice.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );

  const optionButtons = (
    <div ref={optionsRef} role="group" aria-label={current.name} className="kidpix-options">
      {sizesControl}
      {modesControl}
      {readControls}
      {shownOptions.map((option) => (
        <button
          key={option.index}
          type="button"
          className="kidpix-option mu-focus"
          aria-label={option.label}
          aria-pressed={pressedOption(option.index)}
          title={option.label}
          onClick={() => chooseOption(option.index)}
        >
          {"sheet" in option.content ? (
            <span
              aria-hidden
              className="kidpix-icon"
              data-sheet={option.content.sheet}
              data-tint={option.content.tint ? "" : undefined}
              style={
                option.content.tint
                  ? {
                      backgroundColor: option.content.tint,
                      maskPosition: `calc(var(--kp-cell) * -${option.content.cell}) 0`,
                      maskSize: `calc(var(--kp-cell) * ${option.content.cells}) var(--kp-cell)`,
                      WebkitMaskPosition: `calc(var(--kp-cell) * -${option.content.cell}) 0`,
                      WebkitMaskSize: `calc(var(--kp-cell) * ${option.content.cells}) var(--kp-cell)`,
                    }
                  : {
                      backgroundPosition: `calc(var(--kp-cell) * -${option.content.cell}) 0`,
                      backgroundSize: `calc(var(--kp-cell) * ${option.content.cells}) var(--kp-cell)`,
                    }
              }
            />
          ) : "url" in option.content ? (
            <span
              aria-hidden
              className="kidpix-icon"
              data-pixelated={option.content.pixelated || undefined}
              style={{
                backgroundImage: option.content.url ? `url("${option.content.url}")` : undefined,
                backgroundPosition: `calc(var(--kp-cell) * -${option.content.cell}) 0`,
                backgroundSize: `calc(var(--kp-cell) * ${option.content.cells}) var(--kp-cell)`,
              }}
            />
          ) : (
            <span aria-hidden className={option.content.className} style={option.content.style}>
              {option.content.text}
            </span>
          )}
        </button>
      ))}
    </div>
  );

  const categorySelect = isLibraryTool(tool) && (
    <select
      className="kidpix-category mu-focus"
      aria-label={current.name}
      value={toolCategory}
      onChange={(event) => chooseCategory(Number(event.target.value))}
    >
      {CATEGORIES[tool].map((item, index) => (
        <option key={item.slug} value={index}>
          {item.name}
        </option>
      ))}
    </select>
  );

  // A tool's kinds sit in the tray's first panel, in the current color, and move as Kid Pix moves them:
  // the Pencil's four, the brush zone's paint brush and Spray Can, and the three Fill Buckets.
  const kindButtons = (art: KindArt, names: readonly string[], selected: number, select: (index: number) => void) => (
    <KindPanel
      key={art}
      art={art}
      label={current.name}
      names={names}
      selected={selected}
      color={color}
      play={play}
      onSelect={(index) => {
        settle();
        select(index);
      }}
    />
  );
  const chooseBrushKind = (index: number) => {
    setBrushKind(index);
    if (index === 1) spraySheet(spraySet);
    optionsRef.current?.scrollTo({ left: 0 });
  };
  const chooseBucketKind = (index: number) => {
    setBucketKind(index);
    optionsRef.current?.scrollTo({ left: 0 });
  };
  const pencilKinds =
    tool === "pencil"
      ? kindButtons("pencil", PENCIL_KINDS, pencilKind, setPencilKind)
      : tool === "wacky"
        ? kindButtons("brush", BRUSH_KINDS, brushKind, chooseBrushKind)
        : tool === "paint"
          ? kindButtons("bucket", BUCKET_KINDS, bucketKind, chooseBucketKind)
          : null;
  const toolPanel = pencilKinds || textControls || categorySelect;

  const colorButton = (
    <button
      type="button"
      className="kidpix-color mu-focus"
      aria-label={labels.color}
      aria-expanded={paletteOpen}
      title={labels.color}
      onClick={() => {
        setPaletteOpen((open) => !open);
        play("easel1029");
      }}
    >
      <span aria-hidden style={{ background: color }} />
      <span aria-hidden />
    </button>
  );

  const undoGuy = (
    <button type="button" className="kidpix-undo-guy mu-focus" aria-label={labels.undo} title={labels.undo} onClick={undo}>
      <span aria-hidden style={{ backgroundPosition: `-${guyFrame * 40}px 0` }} />
    </button>
  );

  const dynamiteButton = (
    <button
      type="button"
      className="kidpix-dynamite mu-focus"
      aria-label={labels.clear}
      title={labels.clear}
      data-fuse={fuse === null ? undefined : ""}
      style={fuse === null ? undefined : ({ "--kp-fuse": fuse } as CSSProperties)}
      onClick={dynamite}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") sparkFuse();
      }}
      onPointerLeave={snuffFuse}
    />
  );

  return (
    <div ref={rootRef} tabIndex={-1} className="kidpix" data-compact={compact || undefined}>
      <canvas
        ref={backgroundRef}
        aria-hidden
        className="kidpix-backdrop"
        width={width}
        height={height}
        style={{ width: view.width, height: view.height }}
      />
      <canvas
        ref={canvasRef}
        className="kidpix-paint"
        data-tool={tool}
        width={width}
        height={height}
        style={{ width: view.width, height: view.height }}
        // A press must not take the focus from the text field it has just opened.
        onMouseDown={(event) => event.preventDefault()}
        onPointerDown={handlePointerDown}
        onPointerMove={(event) => engineRef.current?.move(pointOf(event))}
        onPointerUp={liftPointer}
        onPointerCancel={liftPointer}
      />

      {stickerFrame}

      {typing && (
        <textarea
          ref={inputRef}
          className="kidpix-typing"
          aria-label={current.name}
          value={draft}
          wrap="off"
          spellCheck={false}
          style={{
            left: typing.x * view.zoom - TEXT_PAD,
            top: typing.y * view.zoom - TEXT_PAD,
            width: Math.max(draftWidth, textSize * 3) * view.zoom + TEXT_PAD * 2 + 2,
            height: draft.split("\n").length * textSize * TEXT_LINE * view.zoom + TEXT_PAD * 2,
            // The pieces one by one: the `font` shorthand would reset the line height set beside it.
            fontFamily: textStyle.family,
            fontSize: textSize * view.zoom,
            fontWeight: bold ? "bold" : "normal",
            fontStyle: italic ? "italic" : "normal",
            lineHeight: `${textSize * TEXT_LINE * view.zoom}px`,
            color,
            textAlign: align,
            textDecoration: underline ? "underline" : undefined,
          }}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleTextKey}
        />
      )}

      {rings !== null && (
        <span
          aria-hidden
          className="kidpix-rings"
          style={{ "--kp-rings": `${rings.spread}px`, "--kp-ring-x": `${rings.x}px`, "--kp-ring-y": `${rings.y}px` } as CSSProperties}
        />
      )}

      {compact ? (
        <div className="kidpix-panel">
          {toolPanel && <div>{toolPanel}</div>}
          <div>
            {colorButton}
            {optionButtons}
            {undoGuy}
          </div>
          <div role="toolbar" aria-label={labels.tools} className="kidpix-strip">
            {toolButtons}
            {dynamiteButton}
          </div>
        </div>
      ) : (
        <>
          <div className="kidpix-tube">
            <div role="toolbar" aria-label={labels.tools}>
              {toolButtons}
            </div>
            {dynamiteButton}
            {undoGuy}
          </div>
          <div className="kidpix-wheel">{colorButton}</div>
          <div className="kidpix-tray">
            <div aria-hidden className="kidpix-tray-art" />
            <div aria-hidden className="kidpix-tray-art" />
            <div aria-hidden className="kidpix-tray-art" />
            <div className="kidpix-tray-info">
              {pencilKinds || textControls || (
                <>
                  <strong>{current.name}</strong>
                  {categorySelect}
                </>
              )}
            </div>
            {optionButtons}
            {/* The arrows turn the tray's pages; the number between them is the page on show. */}
            <div className="kidpix-pager">
              <button
                type="button"
                className="mu-focus"
                aria-label={labels.previous}
                title={labels.previous}
                disabled={pages < 2}
                onClick={() => turnPage(-1)}
              />
              <output aria-live="polite">{pages > 1 ? String(page + 1).padStart(2, "0") : ""}</output>
              <button
                type="button"
                className="mu-focus"
                aria-label={labels.next}
                title={labels.next}
                disabled={pages < 2}
                onClick={() => turnPage(1)}
              />
            </div>
          </div>
        </>
      )}

      {paletteOpen && (
        <div role="group" aria-label={labels.color} className="kidpix-palette">
          {PALETTE.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className="mu-focus"
              aria-label={swatch}
              aria-pressed={swatch === color}
              style={{ background: swatch }}
              onClick={() => chooseColor(swatch)}
            />
          ))}
        </div>
      )}

      {splash && <span aria-hidden className="kidpix-splash" />}
    </div>
  );
};

export default KidPixLayer;
