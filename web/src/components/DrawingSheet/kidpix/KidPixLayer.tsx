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
import fillsUrl from "./assets/fills.jpg";
import gradientsUrl from "./assets/grad.png";
import lettersUrl from "./assets/letters.png";
import solidTilesUrl from "./assets/solid-tiles.png";
import soundsUrl from "./assets/sounds.m4a";
import brushesUrl from "./assets/wacky.png";
import { KidPixAudio } from "./audio";
import type { Point } from "./brushes";
import { KidPixEngine, type KidPixImages, type KidPixTile } from "./engine";
import "./kidpix.css";
import { KIDPIX_BACKGROUNDS, KIDPIX_STAMPS, KIDPIX_STICKERS } from "./library";
import { KIDPIX_SPRAY_SETS } from "./spray";
import { readStickers, type SwfPicture } from "./swf";
import {
  BRUSH_COUNT,
  BRUSH_KINDS,
  BUCKET_KINDS,
  ERASER_SIZES,
  FONTS,
  GRADIENT_COUNT,
  type KidPixTool,
  MIXER_COUNT,
  PALETTE,
  PATTERN_COUNT,
  PENCIL_KINDS,
  PENCIL_SHAPES,
  PENCIL_SIZES,
  SCREEN_ERASER_COUNT,
  SOLID_COUNT,
  TEXT_SIZE,
  TOOL_NUMBER,
  TUBE_TOOLS,
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
  };
}

/** A sticker just put down: it can still be moved, sized and flipped, and becomes paint when it is let go. Layer px. */
interface FloatingSticker {
  name: string;
  picture: SwfPicture;
  x: number;
  y: number;
  width: number;
  height: number;
  flipX: boolean;
  flipY: boolean;
}

/** The Pencil's tray holds its sizes, then its shapes; a shape's option index starts here. */
const SHAPE_OPTION = 100;

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
  bucketKind: number,
  color: string,
  category: number,
  stickerThumbs: readonly string[],
  noBackground: string,
): Option[] => {
  switch (tool) {
    case "pencil":
      return [
        ...PENCIL_SIZES.map((size, index) => ({
          index,
          label: `${size} px`,
          content: { className: "kidpix-dot", style: { width: size, height: size, background: color } },
        })),
        ...PENCIL_SHAPES.map((shape, index) => sprite("shapes", index, PENCIL_SHAPES.length, SHAPE_OPTION + index, shape.name)),
      ];
    case "wacky":
      if (spraying) return KIDPIX_SPRAY_SETS.map((set, index) => sprite("spray", index, KIDPIX_SPRAY_SETS.length, index, set.name));
      // The first twenty brush icons are shapes without a color of their own: Kid Pix shows them in the color in hand.
      return Array.from({ length: BRUSH_COUNT }, (_, index) => {
        const option = sprite("brushes", index, 57, index, toolLabel(index));
        return index < 20 ? { ...option, content: { sheet: "brushes", cell: index, cells: 57, tint: color } } : option;
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
        ...ERASER_SIZES.map((size, index) => {
          const side = Math.min(30, size * 0.7);
          return { index, label: `${size} px`, content: { className: "kidpix-block", style: { width: side, height: side } } };
        }),
        ...Array.from({ length: SCREEN_ERASER_COUNT }, (_, index) =>
          sprite("erasers", index, SCREEN_ERASER_COUNT, index + ERASER_SIZES.length, toolLabel(TOOL_NUMBER.firstScreenEraser + index)),
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
      return FONTS.map((font, index) => ({
        index,
        label: font.name,
        content: { className: "kidpix-font", style: { fontFamily: font.family }, text: "Aa" },
      }));
    case "move":
      return [];
  }
};

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
  const inputRef = useRef<HTMLInputElement>(null);
  const engineRef = useRef<KidPixEngine | null>(null);
  const audioRef = useRef<KidPixAudio | null>(null);
  const timersRef = useRef<{ tool?: number; guy?: number; boom?: number }>({});
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
  const [spraySet, setSpraySet] = useState(0);
  const spraying = tool === "wacky" && brushKind === 1;
  const [color, setColor] = useState("#ff0080");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [typing, setTyping] = useState<Point | null>(null);
  // The selected tool's button plays its animation once, then rests on its last frame.
  const [toolFrame, setToolFrame] = useState((TUBE_TOOLS.find((item) => item.key === "wacky") ?? TUBE_TOOLS[0]).frames - 1);
  const [guyFrame, setGuyFrame] = useState(UNDO_GUY_REST);
  const [boom, setBoom] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);
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
      brushes: loadImage(brushesUrl),
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
      window.clearInterval(timers.guy);
      window.clearInterval(timers.boom);
      // Lifts the pointer, so a Spray Can still spraying stops.
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

  useImperativeHandle(ref, () => ({
    hasPaint: () => Boolean(floatingRef.current) || Boolean(engineRef.current?.hasPaint()),
    takeTiles: (maxSide) => {
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

  const commitText = () => {
    const at = typing;
    const input = inputRef.current;
    if (!at || !input) return;
    // Enter and the blur that follows both land here; emptying the field makes the second a no-op.
    const value = input.value;
    input.value = "";
    // The text starts inside the field's padding and border.
    engineRef.current?.text({ x: at.x + 5 / view.zoom, y: at.y }, value, FONTS[chosen.text].family);
    setTyping(null);
  };

  /** Whatever is half-done is finished or dropped before the tray changes under it. */
  const settle = () => {
    commitText();
    flattenSticker();
    engineRef.current?.settle();
  };

  const chooseTool = (next: (typeof TUBE_TOOLS)[number]) => {
    settle();
    setPaletteOpen(false);
    setTool(next.key);
    play(next.selectSound);
    let frame = 0;
    window.clearInterval(timersRef.current.tool);
    setToolFrame(0);
    timersRef.current.tool = window.setInterval(() => {
      frame++;
      if (frame >= 8) {
        window.clearInterval(timersRef.current.tool);
        setToolFrame(next.frames - 1);
      } else {
        setToolFrame(frame % (next.frames - 1));
      }
    }, 120);
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
    return sheet;
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
    if (tool === "pencil" && index >= SHAPE_OPTION) {
      setPencilShape(index - SHAPE_OPTION);
      play("easel1029");
      return;
    }
    if (tool === "paint") {
      setBucketChoice((previous) => previous.map((choice, kind) => (kind === bucketKind ? index : choice)));
      play("easel1029");
      return;
    }
    if (spraying) {
      setSpraySet(index);
      // Fetched now, so the can is full by the time it is pointed at the paper.
      spraySheet(index);
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
    if (tool === "pencil") engine.shapeDown(at, pencilShape, option, pencilKind);
    else if (spraying) engine.sprayDown(at, spraySheet(spraySet), KIDPIX_SPRAY_SETS[spraySet].frames);
    else if (tool === "wacky") engine.brushDown(at, option);
    else if (tool === "paint") engine.fill(at, bucketKind, bucketChoice[bucketKind]);
    else if (tool === "mixer") {
      if (option < MIXER_COUNT) engine.mix(option);
      else engine.wandDown(at, option - MIXER_COUNT);
    } else if (tool === "eraser") {
      if (option < ERASER_SIZES.length) engine.eraserDown(at, option);
      else engine.wipe(option - ERASER_SIZES.length);
    } else if (tool === "stamp") {
      const sheet = stampSheet(category.stamp);
      if (sheet) engine.stampFrom(at, sheet, option);
      else engine.stamp(at, option);
    } else if (tool === "text") setTyping(at);
    else if (tool === "move") engine.moveDown(at);
  };

  const handleTextKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") commitText();
    if (event.key === "Escape") {
      // Escape leaves the text, not the sheet.
      event.stopPropagation();
      event.nativeEvent.stopPropagation();
      setTyping(null);
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

  // The dynamite: a fuse, then every bit of Kid Pix paint is gone (Undo Guy can bring it back).
  const dynamite = () => {
    commitText();
    float(null);
    engineRef.current?.settle();
    play("easel1027");
    let frame = 0;
    window.clearInterval(timersRef.current.boom);
    setBoom(0);
    timersRef.current.boom = window.setInterval(() => {
      frame++;
      if (frame < 13) {
        setBoom(1 + (frame % 4));
        return;
      }
      window.clearInterval(timersRef.current.boom);
      engineRef.current?.clear();
      play("easel1028");
      setBoom(null);
      setFlash(true);
      window.setTimeout(() => setFlash(false), 460);
    }, 110);
  };

  const scrollOptions = (direction: 1 | -1) => {
    const strip = optionsRef.current;
    if (!strip) return;
    strip.scrollBy({ left: direction * Math.max(84, strip.clientWidth - 42), behavior: "smooth" });
    play("easel1029");
  };

  const current = TUBE_TOOLS.find((item) => item.key === tool) ?? TUBE_TOOLS[0];
  const toolCategory = isLibraryTool(tool) ? category[tool] : 0;
  const options = optionsFor(
    tool,
    spraying,
    bucketKind,
    color,
    toolCategory,
    stickerThumbs.category === category.sticker ? stickerThumbs.urls : [],
    labels.noBackground,
  );

  const toolButtons = TUBE_TOOLS.map((item) => {
    const selected = item.key === tool;
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
          if (!selected && event.pointerType === "mouse") play(item.hoverSound, 0.5);
        }}
      >
        <span
          aria-hidden
          className="kidpix-tool-art"
          style={{ backgroundPosition: `-${(selected ? toolFrame : 0) * 58}px -${item.row * 60}px` }}
        />
      </button>
    );
  });

  // Which option is in hand: the Pencil has a size and a shape, the can a set, each bucket its own fill.
  const pressedOption = (index: number) => {
    if (tool === "background") return false;
    if (tool === "pencil" && index >= SHAPE_OPTION) return pencilShape === index - SHAPE_OPTION;
    if (spraying) return spraySet === index;
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

  const optionButtons = (
    <div ref={optionsRef} role="group" aria-label={current.name} className="kidpix-options">
      {options.map((option) => (
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
                      maskPosition: `-${option.content.cell * 40}px 0`,
                      maskSize: `${option.content.cells * 40}px 40px`,
                      WebkitMaskPosition: `-${option.content.cell * 40}px 0`,
                      WebkitMaskSize: `${option.content.cells * 40}px 40px`,
                    }
                  : {
                      backgroundPosition: `-${option.content.cell * 40}px 0`,
                      backgroundSize: `${option.content.cells * 40}px 40px`,
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
                backgroundPosition: `-${option.content.cell * 40}px 0`,
                backgroundSize: `${option.content.cells * 40}px 40px`,
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

  // A tool's kinds sit in the tray's first panel, in the current color, as Kid Pix shows them:
  // the Pencil's four, and the brush zone's paint brush and Spray Can.
  const kindButtons = (art: "pencil" | "brush" | "bucket", names: readonly string[], selected: number, select: (index: number) => void) => (
    <div role="group" aria-label={current.name} className="kidpix-kinds" data-art={art}>
      {names.map((name, index) => (
        <button
          key={name}
          type="button"
          className="kidpix-kind mu-focus"
          aria-label={name}
          aria-pressed={selected === index}
          title={name}
          onClick={() => {
            settle();
            select(index);
            play("easel1029");
          }}
        >
          <span aria-hidden style={{ background: color }} />
          <span aria-hidden />
        </button>
      ))}
    </div>
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
  const toolPanel = pencilKinds || categorySelect;

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
    <button type="button" className="kidpix-dynamite mu-focus" aria-label={labels.clear} title={labels.clear} onClick={dynamite} />
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
        onPointerUp={() => engineRef.current?.up()}
        onPointerCancel={() => engineRef.current?.up()}
      />

      {stickerFrame}

      {typing && (
        <input
          ref={inputRef}
          className="kidpix-typing"
          aria-label={current.name}
          style={{
            left: typing.x * view.zoom,
            top: (typing.y - TEXT_SIZE * 0.75) * view.zoom,
            height: TEXT_SIZE * 1.5 * view.zoom,
            font: `${TEXT_SIZE * view.zoom}px ${FONTS[chosen.text].family}`,
            color,
          }}
          onKeyDown={handleTextKey}
          onBlur={commitText}
        />
      )}

      {boom !== null && (
        <span
          aria-hidden
          className="kidpix-boom"
          style={{ left: view.width / 2 - 52, top: view.height / 2 - 46, backgroundPosition: `-${boom * 65}px 0` }}
        />
      )}
      {flash && <span aria-hidden className="kidpix-flash" />}

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
              {pencilKinds || (
                <>
                  <strong>{current.name}</strong>
                  {categorySelect}
                </>
              )}
            </div>
            {optionButtons}
            {/* The arrows page the tray; the color between them is the one in hand. */}
            <div className="kidpix-pager">
              <button
                type="button"
                className="mu-focus"
                aria-label={labels.previous}
                title={labels.previous}
                onClick={() => scrollOptions(-1)}
              />
              <span aria-hidden style={{ background: color }} />
              <button type="button" className="mu-focus" aria-label={labels.next} title={labels.next} onClick={() => scrollOptions(1)} />
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
