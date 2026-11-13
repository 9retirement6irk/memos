import { describe, expect, it } from "vitest";
import { dayScore, influences, moodsByDay } from "@/components/Journal/JournalPanel";
import {
  FEELING_IDS,
  feelingsNear,
  IMPACTS,
  mindFromTags,
  mindTags,
  SUGGESTED_FEELINGS,
  VALENCES,
  valenceFromScore,
  valenceScore,
} from "@/lib/journal/mood";
import { defaultJournalSettings } from "@/lib/journal/settings";
import type { Memo } from "@/types/proto/api/memo_service_pb";

const prefixes = { moodTagPrefix: "mood/", feelingTagPrefix: "felt/", impactTagPrefix: "impact/" };

const memo = (iso: string, tags: string[], space = "spaces/journal") =>
  ({
    name: `memos/${iso}`,
    tags,
    space,
    content: "",
    createTime: { seconds: BigInt(Math.floor(new Date(iso).getTime() / 1000)) },
  }) as unknown as Memo;

describe("state of mind", () => {
  it("has Apple's seven steps, 38 feelings and 18 causes", () => {
    expect(VALENCES).toHaveLength(7);
    expect(FEELING_IDS).toHaveLength(38);
    expect(IMPACTS).toHaveLength(18);
  });

  it("maps steps to Apple's -1 to 1 scale and back", () => {
    expect(VALENCES.map(valenceScore)).toEqual([-1, -2 / 3, -1 / 3, 0, 1 / 3, 2 / 3, 1]);
    expect(valenceFromScore(0.4)).toBe("slightly-pleasant");
    expect(valenceFromScore(-5)).toBe("very-unpleasant");
  });

  it("offers the feeling words nearest the step first", () => {
    const pleasant = feelingsNear("very-pleasant").slice(0, SUGGESTED_FEELINGS);
    expect(pleasant).toContain("joyful");
    expect(pleasant).not.toContain("sad");
    const unpleasant = feelingsNear("very-unpleasant").slice(0, SUGGESTED_FEELINGS);
    expect(unpleasant).toContain("hopeless");
    expect(unpleasant).not.toContain("happy");
    expect(feelingsNear("neutral")[0]).toBe("indifferent");
  });

  it("writes tags in order and reads them back", () => {
    const tags = mindTags({ valence: "unpleasant", feelings: ["stressed", "drained"], impacts: ["work", "nonsense"] }, "now", prefixes);
    expect(tags).toEqual(["#mood/unpleasant", "#mood/now", "#felt/stressed", "#felt/drained", "#impact/work"]);
    expect(
      mindFromTags(
        tags.map((tag) => tag.slice(1)),
        prefixes,
      ),
    ).toEqual({
      valence: "unpleasant",
      kind: "now",
      feelings: ["stressed", "drained"],
      impacts: ["work"],
    });
    // An old five-face entry was a day's mood.
    expect(mindFromTags(["mood/great"], prefixes)).toEqual({ valence: "very-pleasant", kind: "today", feelings: [], impacts: [] });
  });
});

describe("journal panel moods", () => {
  it("keeps a day's own mood apart from its right-now check-ins", () => {
    const days = moodsByDay(
      [
        memo("2026-11-10T21:00:00", ["mood/pleasant", "mood/today"]),
        memo("2026-11-10T09:00:00", ["mood/unpleasant", "mood/now"], "spaces/home"),
        memo("2026-11-10T13:00:00", ["mood/neutral", "mood/now"], "spaces/home"),
        memo("2026-11-11T13:00:00", ["mood/very-pleasant", "mood/now"], "spaces/home"),
      ],
      prefixes,
    );
    const tenth = days.get("2026-10-10");
    expect(tenth?.today).toBe("pleasant");
    expect(tenth?.now).toEqual([-2 / 3, 0]);
    // The day's own mood wins over the check-ins; without one, they average.
    expect(dayScore(tenth)).toBeCloseTo(2 / 3);
    expect(dayScore(days.get("2026-10-11"))).toBe(1);
    expect(dayScore(undefined)).toBeUndefined();
  });

  it("finds what comes with good and hard days, from at least two memos each", () => {
    const settings = defaultJournalSettings((id) => id);
    const memos = [
      memo("2026-11-01T20:00:00", ["mood/very-pleasant", "impact/family", "did/exercise"]),
      memo("2026-11-02T20:00:00", ["mood/pleasant", "impact/family", "did/exercise"]),
      memo("2026-11-03T20:00:00", ["mood/very-unpleasant", "impact/work"]),
      memo("2026-11-04T20:00:00", ["mood/unpleasant", "impact/work", "impact/money"]),
      memo("2026-11-05T20:00:00", ["did/reading"]),
    ];
    const { best, worst } = influences(memos, settings, (kind, id) => `${kind}:${id}`);
    expect(best.map((item) => item.label)).toEqual(["impact:family", "activity:exercise"]);
    expect(worst.map((item) => item.label)).toEqual(["impact:work"]);
  });
});
