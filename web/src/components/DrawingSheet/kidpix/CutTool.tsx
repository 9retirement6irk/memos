import { type PointerEvent, type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import shapesUrl from "./assets/cut-shapes.png";
import type { KidPixAudio } from "./audio";
import type { Point } from "./brushes";
import { CUT_GESTURES, CUT_TOOL_NUMBERS, type CutBox, closesPolygon, cutBounds, cutPath, cutterBox, cutterOf } from "./cut";
import { KIDPIX_CUTTERS } from "./cutters";
import type { KidPixEngine } from "./engine";

/** The part of the picture the scissors hold: a shape marked on the paper, or a piece lifted off it. */
interface Piece extends CutBox {
  /** The shape, in alpha, and the same as a URL for the hatching over it. */
  mask: HTMLCanvasElement;
  maskUrl: string;
  /** The paint cut out, once the piece has been picked up; until then it is still on the paper. */
  image: HTMLCanvasElement | null;
  imageUrl: string;
  /** A copy from the Paste jar: the paper under where it came from was never cut. */
  pasted: boolean;
}

/** A shape being drawn: dragged out (free-form, oval, rectangle) or clicked corner by corner. */
type Gesture =
  | { kind: "free"; points: Point[] }
  | { kind: "oval" | "rectangle"; from: Point; to: Point }
  | { kind: "polygon"; points: Point[]; to: Point };

export interface CutToolHandle {
  /** Sticks a lifted piece where it lies and lets go of whatever is marked or half-drawn. */
  settle: () => void;
  /** Lets go of everything without sticking it: for when all the paint goes at once. */
  drop: () => void;
  /** Undo Guy: takes back the piece in hand. False when the scissors hold nothing. */
  undo: () => boolean;
  /** The Trash Can: the marked part of the picture, or the piece in hand, is thrown away. */
  trash: () => void;
  /** Duplicate: remembers the marked part or the piece in hand, for the Paste jar. */
  duplicate: () => void;
  /** Paste: a copy of what Duplicate remembered, in the middle of the paper, ready to move. */
  paste: () => void;
  /** Whether a piece is off the paper, so that the picture is not all in the paint. */
  holding: () => boolean;
}

interface CutToolProps {
  ref: Ref<CutToolHandle>;
  /** Whether the scissors are the tool in hand. */
  active: boolean;
  /** The option in hand: see `CUT_GESTURES` and the cutters after them. */
  option: number;
  /** The paint's size in its own px, and how many screen px one of them takes. */
  width: number;
  height: number;
  zoom: number;
  engine: () => KidPixEngine | null;
  audio: () => KidPixAudio | null;
  play: (clip: string) => void;
  /** Kid Pix's cursors, as CSS: the scissors, the hand over a piece, and the hand holding one. */
  cursors: readonly [string, string, string];
  /** A press on the paper, before the scissors act on it. */
  onPress: () => void;
}

const canvasOf = (width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

/**
 * Kid Pix's scissors. A shape is drawn around part of the picture, or stamped with a cookie
 * cutter, and shows hatched; dragged, the paint in it comes off the paper and follows the
 * pointer, floating over the picture until a press elsewhere sticks it down. The tray's
 * Trash Can, Duplicate and Paste buttons act on it through the handle.
 */
const CutTool = ({ ref, active, option, width, height, zoom, engine, audio, play, cursors, onPress }: CutToolProps) => {
  const [piece, setPieceState] = useState<Piece | null>(null);
  const [gesture, setGestureState] = useState<Gesture | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const pieceRef = useRef<Piece | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const dragRef = useRef<{ from: Point; x: number; y: number } | null>(null);
  const clipboardRef = useRef<{ mask: HTMLCanvasElement; image: HTMLCanvasElement } | null>(null);
  const shapesRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const image = new Image();
    image.src = shapesUrl;
    shapesRef.current = image;
  }, []);

  const setPiece = (next: Piece | null) => {
    pieceRef.current = next;
    setPieceState(next);
  };
  const setGesture = (next: Gesture | null) => {
    gestureRef.current = next;
    setGestureState(next);
  };

  /** Marks a shape on the paper: `draw` fills it on a canvas the size of `box`, in the box's own px. */
  const mark = (box: CutBox | null, draw: (ctx: CanvasRenderingContext2D) => void) => {
    if (!box) return;
    const mask = canvasOf(box.width, box.height);
    const ctx = mask.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#000000";
    draw(ctx);
    setPiece({ ...box, mask, maskUrl: mask.toDataURL(), image: null, imageUrl: "", pasted: false });
    play("w7428");
  };

  const markPolygon = (points: readonly Point[]) => {
    const box = cutBounds(points, width, height);
    mark(box, (ctx) => {
      if (!box) return;
      ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x - box.x, point.y - box.y);
        else ctx.lineTo(point.x - box.x, point.y - box.y);
      });
      ctx.closePath();
      ctx.fill();
    });
  };

  const markDragged = (kind: "oval" | "rectangle", from: Point, to: Point) => {
    const box = cutBounds([from, to], width, height);
    mark(box, (ctx) => {
      if (!box) return;
      if (kind === "rectangle") ctx.fillRect(0, 0, box.width, box.height);
      else {
        ctx.beginPath();
        // The oval is the one dragged out, even where the paper's edge cuts it short.
        const left = Math.min(from.x, to.x) - box.x;
        const top = Math.min(from.y, to.y) - box.y;
        const across = Math.abs(to.x - from.x);
        const down = Math.abs(to.y - from.y);
        ctx.ellipse(left + across / 2, top + down / 2, across / 2, down / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  };

  const markCutter = (cutter: number, at: Point) => {
    const shapes = shapesRef.current;
    const [sx, sy, cutterWidth, cutterHeight] = KIDPIX_CUTTERS[cutter];
    if (!shapes?.complete) return;
    mark(cutterBox(cutter, at), (ctx) => ctx.drawImage(shapes, sx, sy, cutterWidth, cutterHeight, 0, 0, cutterWidth, cutterHeight));
  };

  /** Takes the marked paint off the paper, so the piece can move. */
  const lift = (held: Piece): Piece | null => {
    if (held.image) return held;
    const image = engine()?.lift(held.mask, held.x, held.y, true);
    if (!image) return null;
    const lifted = { ...held, image, imageUrl: image.toDataURL() };
    setPiece(lifted);
    return lifted;
  };

  const settle = () => {
    const held = pieceRef.current;
    if (held?.image) engine()?.stick(held.image, held.x, held.y, held.pasted);
    if (gestureRef.current) audio()?.toolDrop();
    dragRef.current = null;
    setPiece(null);
    setGesture(null);
  };

  const drop = () => {
    if (gestureRef.current) audio()?.toolDrop();
    dragRef.current = null;
    setPiece(null);
    setGesture(null);
  };

  useImperativeHandle(ref, () => ({
    settle,
    drop,
    undo: () => {
      const held = pieceRef.current;
      if (!held && !gestureRef.current) return false;
      // A piece cut from the paper goes back where it came from; a pasted copy, or a mark, just goes.
      if (held?.image && !held.pasted) engine()?.undo();
      drop();
      return true;
    },
    trash: () => {
      const held = pieceRef.current;
      if (!held) return;
      if (!held.image) engine()?.lift(held.mask, held.x, held.y, true);
      setPiece(null);
    },
    duplicate: () => {
      const held = pieceRef.current;
      if (!held) return;
      const image = held.image ?? engine()?.lift(held.mask, held.x, held.y, false);
      if (image) clipboardRef.current = { mask: held.mask, image };
    },
    paste: () => {
      const copy = clipboardRef.current;
      if (!copy) return;
      settle();
      setPiece({
        x: Math.round((width - copy.image.width) / 2),
        y: Math.round((height - copy.image.height) / 2),
        width: copy.image.width,
        height: copy.image.height,
        mask: copy.mask,
        maskUrl: copy.mask.toDataURL(),
        image: copy.image,
        imageUrl: copy.image.toDataURL(),
        pasted: true,
      });
    },
    holding: () => Boolean(pieceRef.current?.image),
  }));

  if (!active && !piece) return null;

  const pointOf = (event: PointerEvent<HTMLDivElement>): Point => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - box.left) * width) / box.width, y: ((event.clientY - box.top) * height) / box.height };
  };

  /** Whether a point is on the piece itself, not just in the box around it. */
  const onPiece = (held: Piece, at: Point) => {
    const x = Math.floor(at.x - held.x);
    const y = Math.floor(at.y - held.y);
    if (x < 0 || y < 0 || x >= held.width || y >= held.height) return false;
    const alpha = held.mask.getContext("2d")?.getImageData(x, y, 1, 1).data[3] ?? 0;
    return alpha > 0;
  };

  const cutter = cutterOf(option);
  const drawn = cutter < 0 ? (CUT_GESTURES[option] ?? "free") : null;

  const handleDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    onPress();
    const at = pointOf(event);
    const held = pieceRef.current;
    const drawing = gestureRef.current;
    if (drawing?.kind === "polygon") {
      // Corner by corner, until a press on the first one closes the shape.
      if (closesPolygon(drawing.points, at)) {
        setGesture(null);
        audio()?.toolUp();
        markPolygon(drawing.points);
      } else setGesture({ ...drawing, points: [...drawing.points, at], to: at });
      return;
    }
    if (held && onPiece(held, at)) {
      const lifted = lift(held);
      if (!lifted) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { from: at, x: lifted.x, y: lifted.y };
      play("w7429");
      return;
    }
    // A press off the piece sticks it down, and starts the next shape.
    settle();
    if (cutter >= 0) {
      markCutter(cutter, at);
      return;
    }
    if (!drawn) return;
    audio()?.toolDown(CUT_TOOL_NUMBERS[drawn]);
    if (drawn === "polygon") {
      setGesture({ kind: "polygon", points: [at], to: at });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setGesture(drawn === "free" ? { kind: "free", points: [at] } : { kind: drawn, from: at, to: at });
  };

  const handleMove = (event: PointerEvent<HTMLDivElement>) => {
    const at = pointOf(event);
    const drag = dragRef.current;
    const held = pieceRef.current;
    if (drag && held) {
      setPiece({ ...held, x: drag.x + at.x - drag.from.x, y: drag.y + at.y - drag.from.y });
      return;
    }
    const drawing = gestureRef.current;
    if (!drawing) {
      setHover(event.pointerType === "mouse" ? at : null);
      return;
    }
    if (drawing.kind === "polygon") {
      setGesture({ ...drawing, to: at });
      return;
    }
    const before = drawing.kind === "free" ? drawing.points[drawing.points.length - 1] : drawing.to;
    audio()?.toolMove(at.x - before.x, at.y - before.y);
    setGesture(drawing.kind === "free" ? { kind: "free", points: [...drawing.points, at] } : { ...drawing, to: at });
  };

  const handleUp = () => {
    if (dragRef.current) {
      dragRef.current = null;
      play("w7430");
      return;
    }
    const drawing = gestureRef.current;
    if (!drawing || drawing.kind === "polygon") return;
    setGesture(null);
    audio()?.toolUp();
    // Let go, a free-form shape closes with a straight line back to where it began.
    if (drawing.kind === "free") markPolygon(drawing.points);
    else markDragged(drawing.kind, drawing.from, drawing.to);
  };

  const hatch = (url: string) => ({ maskImage: `url("${url}")`, WebkitMaskImage: `url("${url}")` });
  const hoverBox = hover && cutter >= 0 && !gesture && !dragRef.current ? cutterBox(cutter, hover) : null;
  const sheetWidth = KIDPIX_CUTTERS.reduce((most, [x, , cutterWidth]) => Math.max(most, x + cutterWidth), 0);
  const sheetHeight = KIDPIX_CUTTERS.reduce((most, [, y, , cutterHeight]) => Math.max(most, y + cutterHeight), 0);

  return (
    <div
      className="kidpix-cut"
      style={{
        width: width * zoom,
        height: height * zoom,
        pointerEvents: active ? undefined : "none",
        cursor: dragRef.current ? cursors[2] : piece && hover && onPiece(piece, hover) ? cursors[1] : cursors[0],
      }}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      onPointerLeave={() => setHover(null)}
    >
      {piece && (
        <div
          className="kidpix-cut-piece"
          data-lifted={piece.image ? "" : undefined}
          style={{ left: piece.x * zoom, top: piece.y * zoom, width: piece.width * zoom, height: piece.height * zoom }}
        >
          {piece.imageUrl && <img src={piece.imageUrl} alt="" draggable={false} />}
          <span aria-hidden className="kidpix-cut-hatch" style={hatch(piece.maskUrl)} />
        </div>
      )}
      {hoverBox && (
        <span
          aria-hidden
          className="kidpix-cut-hatch kidpix-cut-cutter"
          style={{
            left: hoverBox.x * zoom,
            top: hoverBox.y * zoom,
            width: hoverBox.width * zoom,
            height: hoverBox.height * zoom,
            ...hatch(shapesUrl),
            maskPosition: `-${KIDPIX_CUTTERS[cutter][0] * zoom}px -${KIDPIX_CUTTERS[cutter][1] * zoom}px`,
            WebkitMaskPosition: `-${KIDPIX_CUTTERS[cutter][0] * zoom}px -${KIDPIX_CUTTERS[cutter][1] * zoom}px`,
            maskSize: `${sheetWidth * zoom}px ${sheetHeight * zoom}px`,
            WebkitMaskSize: `${sheetWidth * zoom}px ${sheetHeight * zoom}px`,
          }}
        />
      )}
      {gesture && (
        <svg aria-hidden className="kidpix-cut-outline" data-kind={gesture.kind} width={width * zoom} height={height * zoom}>
          {gesture.kind === "free" && <path d={cutPath(gesture.points, zoom, false)} />}
          {gesture.kind === "polygon" && (
            <>
              <path d={cutPath(gesture.points, zoom, false)} />
              <path className="kidpix-cut-band" d={cutPath([gesture.points[gesture.points.length - 1], gesture.to], zoom, false)} />
            </>
          )}
          {gesture.kind === "rectangle" && (
            <rect
              x={Math.min(gesture.from.x, gesture.to.x) * zoom}
              y={Math.min(gesture.from.y, gesture.to.y) * zoom}
              width={Math.abs(gesture.to.x - gesture.from.x) * zoom}
              height={Math.abs(gesture.to.y - gesture.from.y) * zoom}
            />
          )}
          {gesture.kind === "oval" && (
            <ellipse
              cx={((gesture.from.x + gesture.to.x) / 2) * zoom}
              cy={((gesture.from.y + gesture.to.y) / 2) * zoom}
              rx={(Math.abs(gesture.to.x - gesture.from.x) / 2) * zoom}
              ry={(Math.abs(gesture.to.y - gesture.from.y) / 2) * zoom}
            />
          )}
        </svg>
      )}
    </div>
  );
};

export default CutTool;
