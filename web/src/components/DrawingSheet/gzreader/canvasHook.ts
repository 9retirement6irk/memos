/**
 * `@usememos/canvas` fills every pen stroke as a smooth outline and has no way to draw one
 * differently, so the build adds one (see `canvasFreedrawHook` in `vite.config.mts`): where the
 * engine fills a pen stroke it first asks the function kept under this key on `globalThis`,
 * and fills the stroke itself only when that returns false or there is none. The engine's own
 * drawing, its PNG export included, goes through that one place.
 */
export const FREEDRAW_HOOK_KEY = "memos.canvas.drawFreedraw";

/** What the hook is given: the context, already moved to the stroke's place, and the stroke. Returns true when it drew it. */
export type FreedrawHook = (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, element: unknown) => boolean;

/**
 * The engine's built file, with the place it fills a pen stroke asking the hook first.
 * The file is minified, so the place is found by its shape, whatever its names are in this
 * version: `isFreedraw(el) ? (ctx.fillStyle = el.strokeColor, ctx.fill(path(el)))`.
 * Returns null when it isn't there exactly once: the engine changed, and the build should say so.
 */
export const hookCanvasSource = (code: string): string | null => {
  const fill = /(\w+)\((\w+)\)\?\((\w+)\.fillStyle=\2\.strokeColor,\3\.fill\((\w+)\(\2\)\)\)/g;
  const found = [...code.matchAll(fill)];
  if (found.length !== 1) return null;
  const hook = `globalThis[Symbol.for(${JSON.stringify(FREEDRAW_HOOK_KEY)})]`;
  return code.replace(fill, `$1($2)?($3.fillStyle=$2.strokeColor,${hook}?.($3,$2)||$3.fill($4($2)))`);
};
