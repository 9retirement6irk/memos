import { type CSSProperties, type PointerEvent, useEffect, useRef, useState } from "react";
import sheetUrl from "./assets/stamp-editor.png";
import {
  fillStamp,
  flipStamp,
  rotateStamp,
  STAMP_EDITOR_ZOOM,
  STAMP_PX,
  type StampColor,
  type StampPixels,
  setStampPixel,
} from "./stampEdit";
import { STAMP_EDITOR } from "./stampEditor";

type ButtonName = keyof typeof STAMP_EDITOR.buttons;

interface StampEditorProps {
  /** The stamp as it is now, and as the disc has it, each 32 px a side. */
  pixels: StampPixels;
  original: StampPixels;
  /** The color in hand when the editor opens. */
  color: StampColor;
  /** How much of its 516 px the editor may take: a phone shows it smaller. */
  scale: number;
  /** The editor's name, and its buttons by Kid Pix's names or the sheet's own strings. */
  labels: Readonly<Record<ButtonName | "title" | "color", string>>;
  play: (clip: string) => void;
  /** OK hands back the edited stamp; Cancel hands back nothing. */
  onDone: (pixels: StampPixels | null) => void;
}

const [SHEET_WIDTH, SHEET_HEIGHT] = STAMP_EDITOR.sheet;
const SIDE = STAMP_PX * STAMP_EDITOR_ZOOM;

const cut = ([x, y, width, height]: readonly number[]): CSSProperties => ({
  width,
  height,
  backgroundImage: `url("${sheetUrl}")`,
  backgroundPosition: `-${x}px -${y}px`,
  backgroundSize: `${SHEET_WIDTH}px ${SHEET_HEIGHT}px`,
});

/**
 * Kid Pix's Stamp Editor, in its own window and art: a rubber stamp shown eight times its
 * size, to change a pixel at a time with the Pencil or an area with the Fill Bucket, in a
 * color from the grid. Undo takes back the last change (and, clicked again, brings it back);
 * the Firecracker clears the stamp; Flip and Rotate turn it; Restore Original starts over.
 */
const StampEditor = ({ pixels, original, color, scale, labels, play, onDone }: StampEditorProps) => {
  const [now, setNow] = useState<StampPixels>(() => new Uint8ClampedArray(pixels));
  const [before, setBefore] = useState<StampPixels | null>(null);
  const [tool, setTool] = useState<"pencil" | "bucket">("pencil");
  const [ink, setInk] = useState<StampColor>(color);
  const [hot, setHot] = useState<ButtonName | null>(null);
  const [down, setDown] = useState<ButtonName | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const paletteRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef<StampPixels | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    rootRef.current?.focus();
    // The grid's colors are read off its picture where it is clicked.
    const image = new Image();
    image.onload = () => {
      const [x, y, width, height] = STAMP_EDITOR.palette.cell;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")?.drawImage(image, x, y, width, height, 0, 0, width, height);
      paletteRef.current = canvas;
    };
    image.src = sheetUrl;
  }, []);

  useEffect(() => {
    for (const canvas of [canvasRef.current, previewRef.current]) {
      const ctx = canvas?.getContext("2d");
      if (!ctx) continue;
      ctx.clearRect(0, 0, STAMP_PX, STAMP_PX);
      ctx.putImageData(new ImageData(new Uint8ClampedArray(now), STAMP_PX, STAMP_PX), 0, 0);
    }
  }, [now]);

  /** Every change is one step for Undo, which keeps only the last. */
  const change = (next: StampPixels) => {
    setBefore(now);
    setNow(next);
  };

  const pixelOf = (event: PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return [
      Math.floor(((event.clientX - box.left) / box.width) * STAMP_PX),
      Math.floor(((event.clientY - box.top) / box.height) * STAMP_PX),
    ] as const;
  };
  const drawDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    const [x, y] = pixelOf(event);
    const next = new Uint8ClampedArray(now);
    if (tool === "bucket") fillStamp(next, STAMP_PX, x, y, ink);
    else {
      setStampPixel(next, STAMP_PX, x, y, ink);
      event.currentTarget.setPointerCapture(event.pointerId);
      drawingRef.current = next;
    }
    play(STAMP_EDITOR.buttons[tool].clip);
    change(next);
  };
  const drawMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const drawing = drawingRef.current;
    if (!drawing) return;
    const [x, y] = pixelOf(event);
    const next = new Uint8ClampedArray(drawing);
    setStampPixel(next, STAMP_PX, x, y, ink);
    drawingRef.current = next;
    // One drag of the Pencil is one step.
    setNow(next);
  };
  const drawUp = () => {
    drawingRef.current = null;
  };

  const pickColor = (event: PointerEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const palette = paletteRef.current;
    const x = Math.floor(((event.clientX - box.left) / box.width) * STAMP_EDITOR.palette.cell[2]);
    const y = Math.floor(((event.clientY - box.top) / box.height) * STAMP_EDITOR.palette.cell[3]);
    const data = palette?.getContext("2d")?.getImageData(x, y, 1, 1).data;
    if (!data || data[3] < 255) return;
    setInk([data[0], data[1], data[2], 255]);
    play("misc31504");
  };

  const actions: Record<ButtonName, () => void> = {
    pencil: () => setTool("pencil"),
    bucket: () => setTool("bucket"),
    undo: () => {
      if (!before) return;
      setBefore(now);
      setNow(before);
    },
    firecracker: () => change(new Uint8ClampedArray(now.length)),
    flip: () => change(flipStamp(now, STAMP_PX)),
    rotate: () => change(rotateStamp(now, STAMP_PX)),
    restore: () => change(new Uint8ClampedArray(original)),
    cancel: () => onDone(null),
    ok: () => onDone(now),
  };

  const button = (name: ButtonName) => {
    const { states, clip } = STAMP_EDITOR.buttons[name];
    const pressed = name === tool;
    const state = states[down === name || pressed ? 1 : hot === name ? 2 : 0];
    const rest = states[0];
    return (
      <button
        key={name}
        type="button"
        className="kidpix-stamp-editor-button mu-focus"
        aria-label={labels[name]}
        aria-pressed={name === "pencil" || name === "bucket" ? pressed : undefined}
        title={labels[name]}
        style={{ left: rest[4], top: rest[5], width: rest[2], height: rest[3] }}
        onPointerEnter={() => setHot(name)}
        onPointerLeave={() => {
          setHot(null);
          setDown(null);
        }}
        onPointerDown={() => setDown(name)}
        onPointerUp={() => setDown(null)}
        onClick={() => {
          play(clip);
          actions[name]();
        }}
      >
        <span aria-hidden style={{ ...cut(state), left: state[4] - rest[4], top: state[5] - rest[5] }} />
      </button>
    );
  };

  return (
    <div className="kidpix-stamp-editor-veil">
      <div
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-label={labels.title}
        tabIndex={-1}
        className="kidpix-stamp-editor"
        style={{ ...cut(STAMP_EDITOR.window), zoom: scale }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          // Escape closes the editor, not the sheet.
          event.stopPropagation();
          event.nativeEvent.stopPropagation();
          onDone(null);
        }}
      >
        <canvas
          ref={canvasRef}
          className="kidpix-stamp-editor-canvas"
          aria-label={labels.title}
          width={STAMP_PX}
          height={STAMP_PX}
          style={{ left: STAMP_EDITOR.canvas[0], top: STAMP_EDITOR.canvas[1], width: SIDE, height: SIDE }}
          onPointerDown={drawDown}
          onPointerMove={drawMove}
          onPointerUp={drawUp}
          onPointerCancel={drawUp}
        />
        <canvas
          ref={previewRef}
          aria-hidden
          className="kidpix-stamp-editor-canvas"
          width={STAMP_PX}
          height={STAMP_PX}
          style={{ left: STAMP_EDITOR.preview[0], top: STAMP_EDITOR.preview[1], width: STAMP_PX, height: STAMP_PX }}
        />
        <button
          type="button"
          className="kidpix-stamp-editor-palette mu-focus"
          aria-label={labels.color}
          title={labels.color}
          style={{ ...cut(STAMP_EDITOR.palette.cell), left: STAMP_EDITOR.palette.at[0], top: STAMP_EDITOR.palette.at[1] }}
          onPointerDown={pickColor}
        >
          <span aria-hidden style={{ background: `rgb(${ink[0]} ${ink[1]} ${ink[2]})` }} />
        </button>
        {(Object.keys(STAMP_EDITOR.buttons) as ButtonName[]).map(button)}
      </div>
    </div>
  );
};

export default StampEditor;
