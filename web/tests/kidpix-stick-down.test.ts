import { describe, expect, it, vi } from "vitest";
import { KidPixEngine, type KidPixPicture, type LoosePicture } from "@/components/DrawingSheet/kidpix/engine";

/** A 2D context that records what is drawn and hands out numbered snapshots, as jsdom has none. */
const fakeCanvas = () => {
  const log: string[] = [];
  let snapshots = 0;
  const ctx = new Proxy(
    {
      getImageData: () => ({ id: ++snapshots, data: new Uint8ClampedArray(4), width: 1, height: 1 }),
      putImageData: (image: { id: number }) => log.push(`restore ${image.id}`),
    } as Record<string, unknown>,
    { get: (target, key) => (key in target ? target[key as string] : () => undefined) },
  );
  const canvas = { width: 100, height: 80, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, log };
};

const picture = (name: string, log: string[]): KidPixPicture => ({ width: 10, height: 10, draw: () => log.push(`draw ${name}`) });

const engineWith = (canvas: HTMLCanvasElement) =>
  new KidPixEngine(canvas, {
    paper: "#fff",
    backgroundCanvas: canvas,
    backdropSources: () => [],
    images: {} as never,
    audio: { play: vi.fn(), toolDrop: vi.fn() } as never,
    fontFamily: "sans-serif",
  });

const loose = (name: string, log: string[]): LoosePicture => ({
  picture: picture(name, log),
  x: 5,
  y: 5,
  width: 20,
  height: 20,
  flipX: false,
  flipY: false,
});

describe("sticking loose stickers down before paint", () => {
  it("presses them all into the paint, lowest first, as one undo step that gives them back", () => {
    const { canvas, log } = fakeCanvas();
    const engine = engineWith(canvas);
    const items = [loose("cat", log), loose("hat", log)];

    engine.stickDown(items);
    expect(log).toEqual(["draw cat", "draw hat"]);

    // One Undo takes both out of the paint and hands them back to lie loose.
    expect(engine.undo()).toBe(true);
    expect(log.at(-1)).toBe("restore 1");
    expect(engine.undoneLifted).toEqual(items);
    // Nothing else was recorded: a second Undo has nothing left.
    expect(engine.undo()).toBe(false);
    expect(engine.undoneLifted).toBeUndefined();
  });

  it("records nothing when there is nothing loose", () => {
    const { canvas } = fakeCanvas();
    const engine = engineWith(canvas);
    engine.stickDown([]);
    expect(engine.undo()).toBe(false);
  });

  it("gives nothing back when undoing other paint", () => {
    const { canvas, log } = fakeCanvas();
    const engine = engineWith(canvas);
    engine.sticker(picture("star", log), { x: 0, y: 0, width: 10, height: 10 });
    expect(engine.undo()).toBe(true);
    expect(engine.undoneLifted).toBeUndefined();
  });
});
