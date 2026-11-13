import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KidPixAudio } from "@/components/DrawingSheet/kidpix/audio";
import { TUBE_TOOLS } from "@/components/DrawingSheet/kidpix/tools";

/** The clips a tool asks for, in order; jsdom has no audio, so nothing sounds. */
const heard = (audio: KidPixAudio) => {
  const clips: string[] = [];
  vi.spyOn(audio, "play").mockImplementation((clip: string) => {
    clips.push(clip);
    return null;
  });
  return clips;
};

const PENCIL = 99;
const AIRBRUSH = 1;

describe("Kid Pix tool sounds", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps the pencil's loop for when it moves", () => {
    const audio = new KidPixAudio("sounds.m4a");
    const clips = heard(audio);
    audio.toolDown(PENCIL);
    expect(clips).toEqual(["w7286"]);
    audio.toolMove(0, 0);
    expect(clips).toEqual(["w7286"]);
    audio.toolMove(10, 0);
    // Setting off east plays that turn's clip, and the scratching starts.
    expect(clips).toEqual(["w7286", "w7285", "w7287"]);
  });

  it("starts an airbrush's hiss as it goes down", () => {
    const audio = new KidPixAudio("sounds.m4a");
    const clips = heard(audio);
    audio.toolDown(AIRBRUSH);
    expect(clips).toContain("w7279");
  });

  it("plays a turn's clip once per turn, up and down before left and right", () => {
    const audio = new KidPixAudio("sounds.m4a");
    const clips = heard(audio);
    const turns = () => clips.filter((clip) => ["w7283", "w7284", "w7285"].includes(clip));
    audio.toolDown(PENCIL);
    audio.toolMove(10, 0);
    audio.toolMove(10, 0);
    expect(turns()).toEqual(["w7285"]);
    // Down the screen is the cfg's north.
    audio.toolMove(0, 10);
    expect(turns()).toEqual(["w7285", "w7283"]);
    // East again is no turn: the stroke never went west.
    audio.toolMove(10, 0);
    expect(turns()).toEqual(["w7285", "w7283"]);
    audio.toolMove(0, -10);
    expect(turns()).toEqual(["w7285", "w7283", "w7284"]);
    // A stroke setting off both ways at once sounds its up-or-down turn only.
    audio.toolUp();
    audio.toolDown(PENCIL);
    audio.toolMove(10, 10);
    audio.toolMove(10, 10);
    expect(turns()).toEqual(["w7285", "w7283", "w7284", "w7283"]);
  });

  it("does not take a shaky line for turns", () => {
    const audio = new KidPixAudio("sounds.m4a");
    const clips = heard(audio);
    audio.toolDown(PENCIL);
    audio.toolMove(10, 1);
    audio.toolMove(10, -1);
    audio.toolMove(10, 2);
    expect(clips.filter((clip) => clip === "w7283" || clip === "w7284")).toEqual([]);
  });
});

describe("the tube's button scripts", () => {
  it("name frames the button has, and start the tool's clip once a pass", () => {
    for (const tool of TUBE_TOOLS) {
      const frames = tool.hover.filter((step) => step !== "clip");
      expect(frames.length).toBeGreaterThan(2);
      // The last frame of a row is the lit one, which only a click shows.
      for (const frame of frames) expect(frame).toBeLessThan(tool.frames - 1);
      expect(tool.hover.filter((step) => step === "clip").length).toBeGreaterThan(0);
    }
  });
});
