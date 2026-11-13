/**
 * The Wacky Brush strokes. Kid Pix's own brush code is not in the assets, so each brush here is
 * drawn after its icon and name; the sounds, icons and names are the real ones.
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
}

export interface BrushEnv {
  color: string;
  /** A repeating fill cut from the brush's own icon, for the bricks, log, window, door and roof brushes. */
  pattern: (brush: number) => CanvasPattern | null;
  fontFamily: string;
  random: () => number;
  /** How much the tray's size grows or shrinks a brush that has sizes. */
  scale: number;
}

export const newStroke = (start: Point, hue: number): StrokeState => ({ start, hue, side: 1, previous: null, travelled: 0, count: 0 });

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

const star = (ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) => {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    const reach = i % 2 ? radius * 0.45 : radius;
    ctx.lineTo(x + Math.cos(angle) * reach, y + Math.sin(angle) * reach);
  }
  ctx.closePath();
  ctx.fill();
};

const bright = (env: BrushEnv, lightness = 52) => `hsl(${Math.floor(env.random() * 360)} 95% ${lightness}%)`;

/** A tree grows where the Tree brush lands; it draws once, not along the stroke. */
const tree = (ctx: CanvasRenderingContext2D, env: BrushEnv, x: number, y: number, length: number, angle: number, depth: number) => {
  const end = { x: x + Math.cos(angle) * length, y: y + Math.sin(angle) * length };
  line(ctx, { x, y }, end, Math.max(1, depth * 1.4), depth > 2 ? "#5a3a1a" : env.color);
  if (depth <= 0) return;
  const branches = 2 + (env.random() < 0.4 ? 1 : 0);
  for (let i = 0; i < branches; i++) {
    tree(ctx, env, end.x, end.y, length * (0.62 + env.random() * 0.18), angle + (env.random() - 0.5) * 1.3, depth - 1);
  }
};

/** Draws what a brush leaves when it first touches the paper. */
export const brushDown = (ctx: CanvasRenderingContext2D, brush: number, at: Point, env: BrushEnv) => {
  if (brush === 44) tree(ctx, env, at.x, at.y, 46, -Math.PI / 2, 6);
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
    case 0: // RealBrush
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      line(ctx, a, b, 9, color);
      break;
    case 1: // Airbrush
      for (let i = 0; i < 26; i++) {
        const angle = random() * Math.PI * 2;
        const reach = random() * 16;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(b.x + Math.cos(angle) * reach, b.y + Math.sin(angle) * reach, 1.5, 1.5);
      }
      break;
    case 2: // BristleBrush
      for (let i = -3; i <= 3; i++) line(ctx, { x: a.x + i * 2, y: a.y + i * 1.5 }, { x: b.x + i * 2, y: b.y + i * 1.5 }, 1, color);
      break;
    case 3: // ExtrusionBrush
      for (let depth = 8; depth >= 0; depth -= 2) {
        ctx.globalAlpha = depth ? 0.35 : 1;
        line(ctx, { x: a.x + depth, y: a.y + depth }, { x: b.x + depth, y: b.y + depth }, 10, depth ? "#000000" : color);
      }
      break;
    case 20: // Madona
      state.hue = (state.hue + 11) % 360;
      ctx.strokeStyle = `hsl(${state.hue} 100% 50%)`;
      ctx.lineWidth = 2;
      for (let size = 8; size <= 32; size += 12) ctx.strokeRect(b.x - size / 2, b.y - size / 2, size, size);
      break;
    case 21: // Drippy
      line(ctx, a, b, 7, color);
      if (random() < 0.18) {
        const drip = 12 + random() * 60;
        ctx.fillRect(b.x - 2, b.y, 4, drip);
        ctx.beginPath();
        ctx.arc(b.x, b.y + drip, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 22: // Spiral
      if (state.count % 4 === 0) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = bright(env);
        ctx.beginPath();
        for (let t = 0; t < 14; t += 0.3) ctx.lineTo(b.x + Math.cos(t) * t * 1.6, b.y + Math.sin(t) * t * 1.6);
        ctx.stroke();
      }
      break;
    case 23: // Poly
      if (state.count % 3 === 0) {
        ctx.fillStyle = bright(env, 65);
        ctx.beginPath();
        for (let i = 0; i < 3 + Math.floor(random() * 3); i++) ctx.lineTo(b.x + (random() - 0.5) * 60, b.y + (random() - 0.5) * 60);
        ctx.closePath();
        ctx.fill();
      }
      break;
    case 24: {
      // TriSpin
      const spin = state.count * 0.35;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = bright(env);
      ctx.beginPath();
      for (let i = 0; i < 3; i++)
        ctx.lineTo(b.x + Math.cos(spin + (i * Math.PI * 2) / 3) * 22, b.y + Math.sin(spin + (i * Math.PI * 2) / 3) * 22);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 25: // WhispyCircle
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(b.x + (random() - 0.5) * 10, b.y + (random() - 0.5) * 10, 10 + random() * 22, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 26: // Particle
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = bright(env);
        ctx.fillRect(b.x + (random() - 0.5) * 70, b.y + (random() - 0.5) * 70, 2, 2);
      }
      break;
    case 27: // Garland
      line(ctx, state.start, b, 2, bright(env));
      break;
    case 28: // LeakyPen
      line(ctx, a, b, 3, color);
      if (distance < 3 || state.travelled > 40) {
        state.travelled = 0;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 4 + random() * 8, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 29: // ScratchyPen
      for (let i = 0; i < 3; i++) {
        line(
          ctx,
          { x: a.x + (random() - 0.5) * 5, y: a.y + (random() - 0.5) * 5 },
          { x: b.x + (random() - 0.5) * 5, y: b.y + (random() - 0.5) * 5 },
          1,
          color,
        );
      }
      break;
    case 30: // LoopingLine
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y - 12, 12, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 31: // LoopingLine2
      for (let i = 0; i < 3; i++) {
        const angle = -Math.PI / 2 + (random() - 0.5) * 1.6;
        const reach = 10 + random() * 24;
        line(ctx, b, { x: b.x + Math.cos(angle) * reach, y: b.y + Math.sin(angle) * reach }, 2, color);
      }
      break;
    case 32: // Bricks
    case 33: // Log
    case 34: // Window
    case 35: // Door
    case 36: // DoorPlain
    case 37: // Roof
      line(ctx, a, b, 38, env.pattern(brush) ?? color);
      break;
    case 38: // DotToDot
      if (state.travelled > 60 || !state.previous) {
        state.travelled = 0;
        if (state.previous) line(ctx, state.previous, b, 1.5, color);
        ctx.beginPath();
        ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `14px ${env.fontFamily}`;
        ctx.fillText(String(Math.ceil(state.count / 8) || 1), b.x + 7, b.y - 6);
        state.previous = b;
      }
      break;
    case 39: // ABC
      if (state.travelled > 26) {
        state.travelled = 0;
        ctx.font = `${20 + Math.floor(random() * 18)}px ${env.fontFamily}`;
        ctx.fillStyle = bright(env, 45);
        ctx.fillText(String.fromCharCode(65 + Math.floor(random() * 26)), b.x - 8, b.y + 8);
      }
      break;
    case 40: // Rainbow
      state.hue = (state.hue + 7) % 360;
      line(ctx, a, b, 16, `hsl(${state.hue} 100% 50%)`);
      break;
    case 41: // ColorTile
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = bright(env);
      ctx.fillRect(Math.floor(b.x / 24) * 24, Math.floor(b.y / 24) * 24, 24, 24);
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
        line(ctx, mirror(a, !!(i & 1), !!(i & 2), !!(i & 4)), mirror(b, !!(i & 1), !!(i & 2), !!(i & 4)), 3, color);
      break;
    }
    case 43: // Splat
      if (state.count % 2 === 0) {
        ctx.fillStyle = bright(env, 60);
        ctx.beginPath();
        ctx.arc(b.x + (random() - 0.5) * 30, b.y + (random() - 0.5) * 30, 5 + random() * 14, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 44: // Tree: drawn on the way down.
      break;
    default: {
      // CustomBrush1 to 16: the same four nibs at different sizes.
      const width = (4 + ((brush * 5) % 20)) * env.scale;
      const nib = brush % 4;
      if (nib === 0) {
        ctx.shadowColor = color;
        ctx.shadowBlur = width / 2;
        line(ctx, a, b, width, color);
      } else if (nib === 1) {
        for (let i = 0; i < width * 2; i++) ctx.fillRect(b.x + (random() - 0.5) * width * 2, b.y + (random() - 0.5) * width * 2, 1.5, 1.5);
      } else if (nib === 2) {
        ctx.fillStyle = bright(env);
        star(ctx, b.x + (random() - 0.5) * width * 2, b.y + (random() - 0.5) * width * 2, 2 + random() * (width / 3));
      } else {
        for (let i = 0; i < width; i += 2) line(ctx, { x: a.x + i, y: a.y - i }, { x: b.x + i, y: b.y - i }, 1.5, color);
      }
    }
  }
  ctx.restore();
};
