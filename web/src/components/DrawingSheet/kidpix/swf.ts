/**
 * Kid Pix stickers are small Flash movies: uncompressed SWF 3 or 4, one frame, built from
 * DefineShape and DefineShape2 records placed with PlaceObject2. This reads exactly that much
 * of the format and draws it on a canvas. Lengths in a movie are twips, 20 to a pixel.
 */

type Rgba = readonly [number, number, number, number];
type Matrix = readonly [a: number, b: number, c: number, d: number, tx: number, ty: number];
/** A straight edge [x0, y0, x1, y1] or a curve [x0, y0, controlX, controlY, x1, y1], in twips. */
type Edge = readonly number[];

type Paint = { kind: "solid"; color: Rgba } | { kind: "linear" | "radial"; matrix: Matrix; stops: readonly (readonly [number, Rgba])[] };

interface Fill {
  paint: Paint;
  /** Closed outlines, each a chain of edges end to end. */
  outlines: Edge[][];
}

interface Stroke {
  width: number;
  color: Rgba;
  edges: Edge[];
}

interface PlacedShape {
  matrix: Matrix;
  fills: Fill[];
  strokes: Stroke[];
}

export interface SwfPicture {
  /** The movie's frame, in px. */
  width: number;
  height: number;
  /** Draws the picture with its frame's top-left corner at the origin. */
  draw: (ctx: CanvasRenderingContext2D) => void;
  /** How many shapes the frame places; for tests. */
  shapeCount: number;
}

const TWIP = 20;
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** A gradient is defined on a square 32768 twips wide, centered on the origin. */
const GRADIENT_REACH = 16384 / TWIP;

class BitReader {
  private bit = 0;

  constructor(
    private readonly bytes: Uint8Array,
    public position = 0,
  ) {}

  align() {
    if (this.bit) {
      this.position++;
      this.bit = 0;
    }
  }

  unsigned(count: number) {
    let value = 0;
    for (let i = 0; i < count; i++) {
      value = value * 2 + ((this.bytes[this.position] >> (7 - this.bit)) & 1);
      if (++this.bit === 8) {
        this.bit = 0;
        this.position++;
      }
    }
    return value;
  }

  signed(count: number) {
    if (count === 0) return 0;
    const value = this.unsigned(count);
    return value >= 2 ** (count - 1) ? value - 2 ** count : value;
  }

  u8() {
    this.align();
    return this.bytes[this.position++];
  }

  u16() {
    this.align();
    const value = this.bytes[this.position] | (this.bytes[this.position + 1] << 8);
    this.position += 2;
    return value;
  }

  /** [xMin, xMax, yMin, yMax] */
  rect() {
    this.align();
    const bits = this.unsigned(5);
    const box = [this.signed(bits), this.signed(bits), this.signed(bits), this.signed(bits)];
    this.align();
    return box;
  }

  matrix(): Matrix {
    this.align();
    let [a, b, c, d] = [1, 0, 0, 1];
    if (this.unsigned(1)) {
      const bits = this.unsigned(5);
      a = this.signed(bits) / 65536;
      d = this.signed(bits) / 65536;
    }
    if (this.unsigned(1)) {
      const bits = this.unsigned(5);
      b = this.signed(bits) / 65536;
      c = this.signed(bits) / 65536;
    }
    const bits = this.unsigned(5);
    const tx = this.signed(bits);
    const ty = this.signed(bits);
    this.align();
    return [a, b, c, d, tx, ty];
  }

  rgb(): Rgba {
    return [this.u8(), this.u8(), this.u8(), 255];
  }
}

interface ShapeGroup {
  fills: Paint[];
  lines: { width: number; color: Rgba }[];
  fillEdges: Map<number, Edge[]>;
  lineEdges: Map<number, Edge[]>;
}

const readStyles = (reader: BitReader, extended: boolean) => {
  let count = reader.u8();
  if (count === 0xff && extended) count = reader.u16();
  const fills: Paint[] = [];
  for (let i = 0; i < count; i++) {
    const type = reader.u8();
    if (type === 0x00) {
      fills.push({ kind: "solid", color: reader.rgb() });
    } else if (type === 0x10 || type === 0x12) {
      const matrix = reader.matrix();
      const stopCount = reader.u8() & 15;
      const stops: [number, Rgba][] = [];
      for (let j = 0; j < stopCount; j++) stops.push([reader.u8() / 255, reader.rgb()]);
      fills.push({ kind: type === 0x10 ? "linear" : "radial", matrix, stops });
    } else {
      throw new Error(`Unsupported fill style ${type}`);
    }
  }
  count = reader.u8();
  if (count === 0xff) count = reader.u16();
  const lines: { width: number; color: Rgba }[] = [];
  for (let i = 0; i < count; i++) lines.push({ width: reader.u16(), color: reader.rgb() });
  return { fills, lines };
};

const newGroup = (styles: { fills: Paint[]; lines: { width: number; color: Rgba }[] }): ShapeGroup => ({
  ...styles,
  fillEdges: new Map(),
  lineEdges: new Map(),
});

const push = (edges: Map<number, Edge[]>, style: number, edge: Edge) => {
  const list = edges.get(style);
  if (list) list.push(edge);
  else edges.set(style, [edge]);
};

/** Reads a DefineShape body into groups of edges by fill and line style. */
const readShape = (body: Uint8Array, extended: boolean) => {
  const reader = new BitReader(body);
  const id = reader.u16();
  reader.rect();
  let group = newGroup(readStyles(reader, extended));
  const groups = [group];
  reader.align();
  let fillBits = reader.unsigned(4);
  let lineBits = reader.unsigned(4);
  let [x, y, fill0, fill1, line] = [0, 0, 0, 0, 0];
  const add = (edge: number[]) => {
    // An edge has a fill on each side: fill1 to its right as drawn, fill0 to its left.
    if (fill1) push(group.fillEdges, fill1, edge);
    if (fill0) push(group.fillEdges, fill0, [edge[edge.length - 2], edge[edge.length - 1], ...edge.slice(2, -2), edge[0], edge[1]]);
    if (line) push(group.lineEdges, line, edge);
  };
  for (;;) {
    if (reader.unsigned(1) === 0) {
      const flags = reader.unsigned(5);
      if (flags === 0) break;
      if (flags & 1) {
        const bits = reader.unsigned(5);
        x = reader.signed(bits);
        y = reader.signed(bits);
      }
      if (flags & 2) fill0 = reader.unsigned(fillBits);
      if (flags & 4) fill1 = reader.unsigned(fillBits);
      if (flags & 8) line = reader.unsigned(lineBits);
      if (flags & 16) {
        group = newGroup(readStyles(reader, extended));
        groups.push(group);
        reader.align();
        fillBits = reader.unsigned(4);
        lineBits = reader.unsigned(4);
        fill0 = fill1 = line = 0;
      }
    } else if (reader.unsigned(1)) {
      // A straight edge: a general line, or one that only goes down or only across.
      const bits = reader.unsigned(4) + 2;
      const general = reader.unsigned(1) === 1;
      const vertical = !general && reader.unsigned(1) === 1;
      const dx = general || !vertical ? reader.signed(bits) : 0;
      const dy = general || vertical ? reader.signed(bits) : 0;
      add([x, y, x + dx, y + dy]);
      x += dx;
      y += dy;
    } else {
      const bits = reader.unsigned(4) + 2;
      const controlX = x + reader.signed(bits);
      const controlY = y + reader.signed(bits);
      const anchorX = controlX + reader.signed(bits);
      const anchorY = controlY + reader.signed(bits);
      add([x, y, controlX, controlY, anchorX, anchorY]);
      x = anchorX;
      y = anchorY;
    }
  }
  return { id, groups };
};

/** Joins a fill's loose edges, each ending where another begins, into closed outlines. */
const stitch = (edges: Edge[]): Edge[][] => {
  const starts = new Map<string, number[]>();
  edges.forEach((edge, index) => {
    const key = `${edge[0]},${edge[1]}`;
    const list = starts.get(key);
    if (list) list.push(index);
    else starts.set(key, [index]);
  });
  const used = new Uint8Array(edges.length);
  const outlines: Edge[][] = [];
  for (let first = 0; first < edges.length; first++) {
    if (used[first]) continue;
    const outline: Edge[] = [];
    let index = first;
    for (;;) {
      used[index] = 1;
      const edge = edges[index];
      outline.push(edge);
      const [endX, endY] = [edge[edge.length - 2], edge[edge.length - 1]];
      if (endX === edges[first][0] && endY === edges[first][1]) break;
      const next = starts.get(`${endX},${endY}`)?.find((candidate) => !used[candidate]);
      if (next === undefined) break;
      index = next;
    }
    outlines.push(outline);
  }
  return outlines;
};

const css = ([r, g, b]: Rgba) => `rgb(${r} ${g} ${b})`;

const trace = (ctx: CanvasRenderingContext2D, edges: readonly Edge[], closed: boolean) => {
  let [lastX, lastY] = [Number.NaN, Number.NaN];
  for (const edge of edges) {
    if (edge[0] !== lastX || edge[1] !== lastY) ctx.moveTo(edge[0] / TWIP, edge[1] / TWIP);
    if (edge.length === 4) ctx.lineTo(edge[2] / TWIP, edge[3] / TWIP);
    else ctx.quadraticCurveTo(edge[2] / TWIP, edge[3] / TWIP, edge[4] / TWIP, edge[5] / TWIP);
    lastX = edge[edge.length - 2];
    lastY = edge[edge.length - 1];
  }
  if (closed) ctx.closePath();
};

const drawShape = (ctx: CanvasRenderingContext2D, shape: PlacedShape) => {
  const [a, b, c, d, tx, ty] = shape.matrix;
  ctx.save();
  ctx.transform(a, b, c, d, tx / TWIP, ty / TWIP);
  for (const fill of shape.fills) {
    ctx.beginPath();
    for (const outline of fill.outlines) trace(ctx, outline, true);
    ctx.save();
    if (fill.paint.kind === "solid") {
      ctx.fillStyle = css(fill.paint.color);
    } else {
      // The path is set; the gradient's own matrix now only places the gradient.
      const [ga, gb, gc, gd, gtx, gty] = fill.paint.matrix;
      ctx.transform(ga, gb, gc, gd, gtx / TWIP, gty / TWIP);
      const gradient =
        fill.paint.kind === "linear"
          ? ctx.createLinearGradient(-GRADIENT_REACH, 0, GRADIENT_REACH, 0)
          : ctx.createRadialGradient(0, 0, 0, 0, 0, GRADIENT_REACH);
      for (const [offset, color] of fill.paint.stops) gradient.addColorStop(offset, css(color));
      ctx.fillStyle = gradient;
    }
    ctx.fill("evenodd");
    ctx.restore();
  }
  for (const stroke of shape.strokes) {
    ctx.beginPath();
    trace(ctx, stroke.edges, false);
    ctx.strokeStyle = css(stroke.color);
    ctx.lineWidth = Math.max(1, stroke.width / TWIP);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  }
  ctx.restore();
};

/** Reads one sticker. Throws on a movie that uses anything but plain shapes. */
export const readSwfPicture = (bytes: Uint8Array): SwfPicture => {
  if (bytes[0] !== 0x46 || bytes[1] !== 0x57 || bytes[2] !== 0x53) throw new Error("Not an uncompressed Flash movie");
  const header = new BitReader(bytes, 8);
  const [xMin, xMax, yMin, yMax] = header.rect();
  let position = header.position + 4;
  const shapes = new Map<number, ShapeGroup[]>();
  const placed: { depth: number; id: number; matrix: Matrix }[] = [];
  while (position < bytes.length) {
    const head = bytes[position] | (bytes[position + 1] << 8);
    position += 2;
    const code = head >> 6;
    let length = head & 63;
    if (length === 63) {
      length = (bytes[position] | (bytes[position + 1] << 8) | (bytes[position + 2] << 16) | (bytes[position + 3] << 24)) >>> 0;
      position += 4;
    }
    const body = bytes.subarray(position, position + length);
    position += length;
    // End, or ShowFrame: a sticker is its first frame.
    if (code === 0 || code === 1) break;
    if (code === 2 || code === 22) {
      const shape = readShape(body, code === 22);
      shapes.set(shape.id, shape.groups);
    } else if (code === 26) {
      const reader = new BitReader(body);
      const flags = reader.u8();
      const depth = reader.u16();
      const id = flags & 2 ? reader.u16() : -1;
      const matrix = flags & 4 ? reader.matrix() : IDENTITY;
      if (id >= 0) placed.push({ depth, id, matrix });
    } else if (code !== 9) {
      throw new Error(`Unsupported Flash tag ${code}`);
    }
  }
  const pictures: PlacedShape[] = placed
    .sort((first, second) => first.depth - second.depth)
    .map(({ id, matrix }) => {
      const groups = shapes.get(id);
      if (!groups) throw new Error(`Flash movie places a missing shape ${id}`);
      const fills: Fill[] = [];
      const strokes: Stroke[] = [];
      for (const group of groups) {
        for (const style of [...group.fillEdges.keys()].sort((first, second) => first - second)) {
          fills.push({ paint: group.fills[style - 1], outlines: stitch(group.fillEdges.get(style) ?? []) });
        }
        for (const style of [...group.lineEdges.keys()].sort((first, second) => first - second)) {
          strokes.push({ ...group.lines[style - 1], edges: group.lineEdges.get(style) ?? [] });
        }
      }
      return { matrix, fills, strokes };
    });
  return {
    width: (xMax - xMin) / TWIP,
    height: (yMax - yMin) / TWIP,
    shapeCount: pictures.length,
    draw: (ctx) => {
      ctx.save();
      ctx.translate(-xMin / TWIP, -yMin / TWIP);
      for (const picture of pictures) drawShape(ctx, picture);
      ctx.restore();
    },
  };
};

/** Splits a category file into its stickers by the byte lengths the library lists. */
export const readStickers = (bytes: Uint8Array, lengths: readonly number[]): SwfPicture[] => {
  let offset = 0;
  return lengths.map((length) => {
    const picture = readSwfPicture(bytes.subarray(offset, offset + length));
    offset += length;
    return picture;
  });
};
