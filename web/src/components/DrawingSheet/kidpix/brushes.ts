/**
 * The Wacky Brush strokes (tools 20 to 44). Kid Pix's own brush code is not in the assets, so each
 * brush here is drawn after its icon and name; the sounds, icons and names are the real ones. The
 * Realistic brushes (tools 0 to 19) are in realistic.ts.
 */

export interface Point {
  x: number;
  y: number;
}

/** What a brush remembers between the segments of one stroke. */
export interface StrokeState {
  start: Point;
  hue: number;
  side: 1 | -1;
  previous: Point | null;
  travelled: number;
  count: number;
  /** How many letters or numbers the stroke has laid down. */
  index: number;
  /** The Looping Line's pen, which trails the pointer on a spring. */
  lag: Point;
  velocity: Point;
  /** The brick and log places already filled, so each is laid once. */
  laid: Set<string>;
}

export interface BrushEnv {
  color: string;
  /** assets/brush-parts.png: the bricks, logs, roof tile and door pieces from Icons.MHK, once loaded. */
  parts: CanvasImageSource | null;
  /** assets/brush-window.png: the Window brush's frame, once loaded. */
  windowArt: CanvasImageSource | null;
  /** What the ABC brush writes. */
  text: string;
  random: () => number;
}

export const newStroke = (start: Point, hue: number): StrokeState => ({
  start,
  hue,
  side: 1,
  previous: null,
  travelled: 0,
  count: 0,
  index: 0,
  lag: { ...start },
  velocity: { x: 0, y: 0 },
  laid: new Set(),
});

/** Where the pieces sit in assets/brush-parts.png: [x, y, width, height]. */
const PARTS = {
  roof: [0, 0, 64, 32],
  pane: [64, 0, 15, 19],
  knob: [80, 0, 7, 20],
  panels: [
    [88, 0, 20, 20],
    [108, 0, 20, 31],
    [128, 0, 20, 39],
  ],
  /** Seven logs, then six bricks, each 32 x 16. */
  logs: { y: 40, count: 7 },
  bricks: { y: 56, count: 6 },
} as const;
const COURSE = { width: 32, height: 16 };

/** TriSpin's and WhispyCircle's tile, in drawing px. */
const TILE = 30;

/**
 * Brushes that draw one thing between the press and the pointer, redrawn as the pointer moves,
 * as the Draw tool's rectangle is: the box brushes, and Madona, Spiral and Poly.
 */
export const BOX_BRUSHES: ReadonlySet<number> = new Set([20, 22, 23, 34, 35, 36, 37, 40, 41]);

/** What such a brush keeps for one stroke. */
export interface BoxMemo {
  /** Colors picked for the stroke: Madona's four faces, Spiral's bands. */
  colors: readonly string[];
  /** Poly's corners so far, and when the last was set (ms). */
  corners: Point[];
  since: number;
}
export const newBoxMemo = (start: Point, now: number, random: () => number): BoxMemo => ({
  colors: Array.from(
    { length: 12 },
    () => `hsl(${Math.floor(random() * 360)} ${55 + Math.floor(random() * 45)}% ${35 + Math.floor(random() * 30)}%)`,
  ),
  corners: [start],
  since: now,
});
/** Poly sets a new corner where the pointer is this often (ms). */
const POLY_CORNER_MS = 900;
/** Madona's base, a square this wide around the press. */
const PYRAMID_BASE = 20;
/** Spiral: this many bands around, each ring this deep, turning this far per px out. */
const SPIRAL = { bands: 36, ring: 4, twist: 0.042 };

const madona = (ctx: CanvasRenderingContext2D, from: Point, to: Point, memo: BoxMemo) => {
  // A pyramid seen from above: a square base where the brush went down, its tip at the pointer.
  const half = PYRAMID_BASE / 2;
  const base = [
    { x: from.x - half, y: from.y - half },
    { x: from.x + half, y: from.y - half },
    { x: from.x + half, y: from.y + half },
    { x: from.x - half, y: from.y + half },
  ];
  const faces = base.map((corner, at) => ({ a: corner, b: base[(at + 1) % 4], color: memo.colors[at] }));
  // The sides nearest the tip go down first, so the far ones lie over them.
  const far = (face: (typeof faces)[number]) => Math.hypot((face.a.x + face.b.x) / 2 - to.x, (face.a.y + face.b.y) / 2 - to.y);
  for (const face of faces.sort((one, other) => far(one) - far(other))) {
    ctx.fillStyle = face.color;
    ctx.beginPath();
    ctx.moveTo(face.a.x, face.a.y);
    ctx.lineTo(face.b.x, face.b.y);
    ctx.lineTo(to.x, to.y);
    ctx.closePath();
    ctx.fill();
  }
};

const spiral = (ctx: CanvasRenderingContext2D, from: Point, to: Point, memo: BoxMemo) => {
  // A disc out to the pointer, banded in colors that wind round as they go out.
  const reach = Math.hypot(to.x - from.x, to.y - from.y);
  const slice = (Math.PI * 2) / SPIRAL.bands;
  const at = (radius: number, angle: number) => [from.x + Math.cos(angle) * radius, from.y + Math.sin(angle) * radius] as const;
  for (let radius = 0; radius < reach; radius += SPIRAL.ring) {
    const outer = Math.min(reach, radius + SPIRAL.ring);
    for (let band = 0; band < SPIRAL.bands; band++) {
      const inward = band * slice + radius * SPIRAL.twist;
      const outward = band * slice + outer * SPIRAL.twist;
      ctx.fillStyle = memo.colors[band % memo.colors.length];
      ctx.beginPath();
      ctx.moveTo(...at(radius, inward));
      ctx.lineTo(...at(radius, inward + slice));
      ctx.lineTo(...at(outer, outward + slice));
      ctx.lineTo(...at(outer, outward));
      ctx.closePath();
      ctx.fill();
    }
  }
};

const poly = (ctx: CanvasRenderingContext2D, to: Point, env: BrushEnv, memo: BoxMemo, now: number) => {
  // A filled shape from the press, through a corner set every so often, to the pointer.
  if (now - memo.since >= POLY_CORNER_MS) {
    memo.corners.push(to);
    memo.since = now;
  }
  ctx.fillStyle = env.color;
  ctx.strokeStyle = env.color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const corner of memo.corners) ctx.lineTo(corner.x, corner.y);
  ctx.lineTo(to.x, to.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
};

const RAINBOW = ["#ff0000", "#ff8000", "#ffee00", "#00c000", "#0060ff", "#4000c0", "#9000d0"];

/** Draws a box brush's picture between the corner pressed and the corner the pointer is at. */
export const brushBox = (
  ctx: CanvasRenderingContext2D,
  brush: number,
  from: Point,
  to: Point,
  env: BrushEnv,
  memo: BoxMemo,
  now: number,
) => {
  if (brush === 20 || brush === 22 || brush === 23) {
    ctx.save();
    if (brush === 20) madona(ctx, from, to, memo);
    else if (brush === 22) spiral(ctx, from, to, memo);
    else poly(ctx, to, env, memo, now);
    ctx.restore();
    return;
  }
  const x = Math.round(Math.min(from.x, to.x));
  const y = Math.round(Math.min(from.y, to.y));
  const width = Math.round(Math.abs(to.x - from.x));
  const height = Math.round(Math.abs(to.y - from.y));
  if (width < 2 || height < 2) return;
  const part = ([sx, sy, w, h]: readonly [number, number, number, number], dx: number, dy: number) => {
    if (env.parts) ctx.drawImage(env.parts, sx, sy, w, h, dx, dy, w, h);
  };
  const outline = () => {
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  };
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  switch (brush) {
    case 34: // Window: the frame, stretched to the box.
      if (env.windowArt) ctx.drawImage(env.windowArt, x, y, width, height);
      break;
    case 35: {
      // Door: a pale door with rows of panes and a knob.
      const shade = ctx.createLinearGradient(0, y, 0, y + height);
      shade.addColorStop(0, "#ffffff");
      shade.addColorStop(1, "#ffffd0");
      ctx.fillStyle = shade;
      ctx.fillRect(x, y, width, height);
      outline();
      const [, , paneWidth, paneHeight] = PARTS.pane;
      const columns = Math.floor((width - 32 + 2) / (paneWidth + 2));
      const rows = Math.max(1, Math.floor((height * 0.45) / (paneHeight + 2)));
      if (height < paneHeight + 22) break;
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++)
          part(PARTS.pane, x + 16 + column * (paneWidth + 2), y + 11 + row * (paneHeight + 2));
      }
      if (width > 48) part(PARTS.knob, x + width - 13, y + 11 + (rows - 1) * (paneHeight + 2));
      break;
    }
    case 36: {
      // DoorPlain: an orange door with a row of square panels over a row of tall ones.
      ctx.fillStyle = "#d06030";
      ctx.fillRect(x, y, width, height);
      outline();
      const columns = Math.floor((width - 40 + 8) / 28);
      const tall = height - 48 >= 39 ? PARTS.panels[2] : height - 48 >= 31 ? PARTS.panels[1] : null;
      if (height < 40) break;
      for (let column = 0; column < columns; column++) {
        part(PARTS.panels[0], x + 20 + column * 28, y + 10);
        if (tall) part(tall, x + 20 + column * 28, y + 38);
      }
      break;
    }
    case 37: {
      // Roof: shingles in the color, narrowing to the ridge, with the eaves fanning out black.
      const inset = width * 0.25;
      ctx.fillStyle = "#fffbd0";
      ctx.fillRect(x, y, width, height);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x + inset, y);
      ctx.lineTo(x + width - inset, y);
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(x, y + height);
      ctx.closePath();
      ctx.clip();
      if (env.parts) {
        const [sx, sy, w, h] = PARTS.roof;
        for (let ty = y; ty < y + height; ty += h) {
          for (let tx = x; tx < x + width; tx += w) ctx.drawImage(env.parts, sx, sy, w, h, tx, ty, w, h);
        }
      }
      ctx.globalCompositeOperation = "color";
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = env.color;
      ctx.fillRect(x, y, width, height);
      ctx.restore();
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 1.5;
      for (let down = COURSE.height; down <= height; down += COURSE.height) {
        ctx.beginPath();
        ctx.moveTo(x + inset, y);
        ctx.lineTo(x, y + down);
        ctx.moveTo(x + width - inset, y);
        ctx.lineTo(x + width, y + down);
        ctx.stroke();
      }
      outline();
      break;
    }
    case 40: {
      // Rainbow: an arch standing on the box's foot.
      const band = 0.45 / RAINBOW.length;
      RAINBOW.forEach((color, at) => {
        const scale = 1 - (at + 0.5) * band;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(width / 2, height) * band + 0.8;
        ctx.beginPath();
        ctx.ellipse(x + width / 2, y + height, (width / 2) * scale, height * scale, 0, Math.PI, Math.PI * 2);
        ctx.stroke();
      });
      break;
    }
    default: // 41 ColorTile: a block of the color.
      ctx.fillStyle = env.color;
      ctx.fillRect(x, y, width, height);
  }
  ctx.restore();
};

const line = (ctx: CanvasRenderingContext2D, a: Point, b: Point, width: number, color: string | CanvasPattern) => {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
};

/** A tree grows where the Tree brush lands; it draws once, not along the stroke. */
const tree = (ctx: CanvasRenderingContext2D, env: BrushEnv, x: number, y: number, length: number, angle: number, depth: number) => {
  const end = { x: x + Math.cos(angle) * length, y: y + Math.sin(angle) * length };
  line(ctx, { x, y }, end, depth > 3 ? 2 : 1, env.color);
  if (depth <= 0) return;
  const branches = 2 + (env.random() < 0.4 ? 1 : 0);
  for (let i = 0; i < branches; i++) {
    tree(ctx, env, end.x, end.y, length * (0.62 + env.random() * 0.18), angle + (env.random() - 0.5) * 1.3, depth - 1);
  }
};

/** Draws what a brush leaves when it first touches the paper. */
export const brushDown = (ctx: CanvasRenderingContext2D, brush: number, at: Point, env: BrushEnv) => {
  if (brush === 44) tree(ctx, env, at.x, at.y, 20, -Math.PI / 2, 5);
};

/** Draws one segment of a stroke, from `a` to `b`. */
export const brushSegment = (ctx: CanvasRenderingContext2D, brush: number, a: Point, b: Point, state: StrokeState, env: BrushEnv) => {
  const { color, random } = env;
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  state.travelled += distance;
  state.count++;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  switch (brush) {
    case 21: // Drippy
      line(ctx, a, b, 7, color);
      if (random() < 0.3) {
        const drip = 12 + random() * 60;
        ctx.fillRect(b.x - 2, b.y, 4, drip);
        ctx.beginPath();
        ctx.arc(b.x, b.y + drip, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 24: // TriSpin: a black tile with a shaded triangle that turns a little at every stamp.
    case 25: {
      // WhispyCircle: the same tile with two rings.
      if (state.count !== 1 && state.travelled < 14) break;
      state.travelled = 0;
      state.index++;
      const x = Math.round(b.x);
      const y = Math.round(b.y);
      ctx.fillStyle = "#000000";
      ctx.fillRect(x - TILE / 2, y - TILE / 2, TILE, TILE);
      if (brush === 25) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = "#00a000";
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = "#a05050";
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      const corner = (at: number) => {
        const angle = state.index * 0.09 + (at * Math.PI * 2) / 3 - 2.4;
        return { x: x + Math.cos(angle) * 13, y: y + Math.sin(angle) * 13 };
      };
      const [dark, bright, warm] = [corner(0), corner(1), corner(2)];
      const shade = ctx.createLinearGradient(dark.x, dark.y, (bright.x + warm.x) / 2, (bright.y + warm.y) / 2);
      shade.addColorStop(0, "#14104a");
      shade.addColorStop(0.6, "#8a6a10");
      shade.addColorStop(1, "#c03000");
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.moveTo(dark.x, dark.y);
      ctx.lineTo(bright.x, bright.y);
      ctx.lineTo(warm.x, warm.y);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 26: // Particle: a cloud of single specks around the stroke.
      for (let i = 0; i < 40; i++) {
        const angle = random() * Math.PI * 2;
        const reach = (random() + random()) * 22;
        ctx.fillRect(Math.round(b.x + Math.cos(angle) * reach), Math.round(b.y + Math.sin(angle) * reach * 0.7), 1, 1);
      }
      break;
    case 27: // Garland: short bright lines bursting from every point.
      for (let i = 0; i < 24; i++) {
        const angle = random() * Math.PI * 2;
        const reach = 7 + random() * 10;
        line(
          ctx,
          b,
          { x: b.x + Math.cos(angle) * reach, y: b.y + Math.sin(angle) * reach },
          2,
          `hsl(${Math.floor(random() * 360)} 85% ${30 + Math.floor(random() * 40)}%)`,
        );
      }
      break;
    case 28: // LeakyPen: a blot every so often, and no line between.
      if (state.count === 1 || state.travelled >= 12) {
        state.travelled = 0;
        const wide = random() < 0.15 ? 6.5 : 5.5;
        ctx.beginPath();
        ctx.ellipse(b.x, b.y, wide, wide * 0.75, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 29: {
      // ScratchyPen: a hairline that keeps to the stroke but for the odd jerk aside.
      const jerk = random() < 0.25 ? 16 : 2;
      const point = { x: b.x + (random() - 0.5) * jerk, y: b.y + (random() - 0.5) * jerk };
      line(ctx, state.previous ?? a, point, 1, color);
      state.previous = point;
      break;
    }
    case 30: {
      // LoopingLine: the pen trails the pointer on a spring, rounding every corner.
      const steps = Math.max(1, Math.ceil(distance / 4));
      for (let step = 0; step < steps; step++) {
        state.velocity = {
          x: state.velocity.x * 0.9 + (b.x - state.lag.x) * 0.012,
          y: state.velocity.y * 0.9 + (b.y - state.lag.y) * 0.012,
        };
        const next = { x: state.lag.x + state.velocity.x, y: state.lag.y + state.velocity.y };
        line(ctx, state.lag, next, 2, color);
        state.lag = next;
      }
      break;
    }
    case 31: {
      // LoopingLine2: a saw-tooth across the stroke, 28 px a tooth.
      if (distance === 0) break;
      const across = ((state.travelled % 28) / 28 - 0.5) * 28;
      const point = { x: b.x + (-(b.y - a.y) / distance) * across, y: b.y + ((b.x - a.x) / distance) * across };
      line(ctx, state.previous ?? a, point, 2, color);
      state.previous = point;
      break;
    }
    case 32: // Bricks: laid in courses, every other course half a brick along.
    case 33: {
      // Log: laid in a stack.
      if (!env.parts) break;
      const tiles = brush === 32 ? PARTS.bricks : PARTS.logs;
      const course = Math.floor((b.y - state.start.y + COURSE.height / 2) / COURSE.height);
      const shift = brush === 32 && course % 2 !== 0 ? COURSE.width / 2 : 0;
      const along = Math.floor((b.x - state.start.x + COURSE.width / 2 - shift) / COURSE.width);
      const place = `${along}:${course}`;
      if (state.laid.has(place)) break;
      state.laid.add(place);
      ctx.drawImage(
        env.parts,
        Math.floor(random() * tiles.count) * COURSE.width,
        tiles.y,
        COURSE.width,
        COURSE.height,
        Math.round(state.start.x - COURSE.width / 2 + shift + along * COURSE.width),
        Math.round(state.start.y - COURSE.height / 2 + course * COURSE.height),
        COURSE.width,
        COURSE.height,
      );
      break;
    }
    case 38: // DotToDot: numbered dots, for joining up later.
      if (state.count === 1 || state.travelled >= 18) {
        state.travelled = 0;
        state.index++;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = "12px Arial, sans-serif";
        ctx.fillText(String(state.index), b.x + 5, b.y + 14);
      }
      break;
    case 39: // ABC: the brush's text, a letter at a time.
      if (state.count === 1 || state.travelled >= 55) {
        state.travelled = 0;
        const letter = env.text[state.index % env.text.length] ?? "";
        state.index++;
        ctx.font = "20px Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(letter, b.x, b.y + 7);
      }
      break;
    case 42: {
      // 8WayMirror
      const [cx, cy] = [ctx.canvas.width / 2, ctx.canvas.height / 2];
      const mirror = (p: Point, flipX: boolean, flipY: boolean, swap: boolean): Point => {
        const dx = (flipX ? -1 : 1) * (p.x - cx);
        const dy = (flipY ? -1 : 1) * (p.y - cy);
        return swap ? { x: cx + dy, y: cy + dx } : { x: cx + dx, y: cy + dy };
      };
      for (let i = 0; i < 8; i++)
        line(ctx, mirror(a, !!(i & 1), !!(i & 2), !!(i & 4)), mirror(b, !!(i & 1), !!(i & 2), !!(i & 4)), 1, color);
      break;
    }
    case 43: // Splat: a blob of some color at every point.
      for (let blob = 0; blob < 3; blob++) {
        ctx.fillStyle = `hsl(${Math.floor(random() * 360)} ${40 + Math.floor(random() * 60)}% ${25 + Math.floor(random() * 50)}%)`;
        ctx.beginPath();
        ctx.arc(b.x + (random() - 0.5) * 28, b.y + (random() - 0.5) * 28, 9 + random() * 6, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 44: // Tree: drawn on the way down.
      break;
    default:
      break;
  }
  ctx.restore();
};
