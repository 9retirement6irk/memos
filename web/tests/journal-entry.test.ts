import { afterEach, describe, expect, it, vi } from "vitest";
import { composeEntry, moodFromTags, normalizePrefix, tagSegment, weatherLine } from "@/lib/journal/entry";
import { formatDistance, projectRoute } from "@/lib/journal/route";
import { defaultJournalSettings, withDefaults } from "@/lib/journal/settings";
import { groupPhotos, type SuggestionPhoto, spreadPick } from "@/lib/journal/suggestions";
import { weatherAt, weatherKind } from "@/lib/journal/weather";

const base = { body: "", goals: [], activities: [], moodTagPrefix: "mood/", activityTagPrefix: "did/" };

describe("journal entries", () => {
  it("writes an entry stock Memos can read: heading, prompt, body, goals, weather, then tags", () => {
    const content = composeEntry({
      ...base,
      heading: "Wednesday, November 11",
      prompt: "What made you smile?",
      body: "  The dog found a stick twice his size.\n",
      goals: [
        { label: "Walk 30 minutes", done: true },
        { label: "Read", done: false },
      ],
      weather: weatherLine(51, "fahrenheit", "partly cloudy"),
      mood: "good",
      activities: ["family", "exercise"],
    });

    expect(content).toBe(
      [
        "## Wednesday, November 11",
        "> What made you smile?",
        "The dog found a stick twice his size.",
        "- [x] Walk 30 minutes\n- [ ] Read",
        "51°F, partly cloudy",
        "#mood/good #did/family #did/exercise",
      ].join("\n\n") + "\n",
    );
  });

  it("leaves out an unanswered prompt and anything not picked", () => {
    expect(composeEntry({ ...base, prompt: "What did you learn?", body: "   " })).toBe("\n");
    expect(composeEntry({ ...base, body: "Quiet day.", mood: "okay" })).toBe("Quiet day.\n\n#mood/okay\n");
  });

  it("turns labels and prefixes into tags Memos accepts", () => {
    expect(tagSegment("  Board Games / Cards! ")).toBe("board-games-cards");
    expect(tagSegment("Café")).toBe("café");
    expect(normalizePrefix("Mood")).toBe("mood/");
    expect(normalizePrefix("/journal//Mood/")).toBe("journal/mood/");
    expect(normalizePrefix("")).toBe("");
    expect(composeEntry({ ...base, body: "x", mood: "great", moodTagPrefix: "" })).toBe("x\n\n#great\n");
  });

  it("reads the mood back from a memo's tags", () => {
    expect(moodFromTags(["did/work", "mood/Bad"], "mood/")).toBe("bad");
    expect(moodFromTags(["feelings/great"], "feelings")).toBe("great");
    expect(moodFromTags(["mood/sleepy", "work"], "mood/")).toBeUndefined();
  });

  it("fills settings saved by an older version from the defaults", () => {
    const defaults = defaultJournalSettings((id) => `label:${id}`);
    const settings = withDefaults({ space: "spaces/journal", defaultCity: undefined }, defaults);

    expect(settings.space).toBe("spaces/journal");
    expect(settings.moodTagPrefix).toBe("mood/");
    expect(settings.activities.find((activity) => activity.id === "work")?.label).toBe("label:work");
  });
});

describe("photo suggestions", () => {
  const photo = (id: string, iso: string, place?: Partial<SuggestionPhoto>): SuggestionPhoto => ({
    id,
    fileName: `${id}.jpg`,
    mimeType: "image/jpeg",
    takenAt: new Date(iso),
    ...place,
  });

  it("groups photos taken close together into outings, newest first", () => {
    const groups = groupPhotos([
      photo("a", "2026-11-10T09:00:00Z"),
      photo("b", "2026-11-10T09:40:00Z", { latitude: 42.36, longitude: -71.06, city: "Boston" }),
      photo("c", "2026-11-10T10:30:00Z"),
      photo("lonely", "2026-11-10T14:00:00Z"),
      photo("d", "2026-11-10T18:00:00Z"),
      photo("e", "2026-11-10T18:05:00Z"),
      photo("f", "2026-11-10T18:10:00Z"),
    ]);

    expect(groups.map((group) => group.photos.map((p) => p.id))).toEqual([
      ["d", "e", "f"],
      ["a", "b", "c"],
    ]);
    expect(groups[1]).toMatchObject({ city: "Boston", latitude: 42.36, longitude: -71.06 });
    expect(groups[0].city).toBeUndefined();
  });

  it("picks photos spread across an outing", () => {
    expect(spreadPick([1, 2, 3, 4, 5, 6, 7, 8, 9], 3)).toEqual([1, 5, 9]);
    expect(spreadPick([1, 2], 6)).toEqual([1, 2]);
  });
});

describe("routes", () => {
  it("fits a route inside the image without stretching it", () => {
    const points = projectRoute(
      [
        { lat: 0, lon: 0, time: "" },
        { lat: 0, lon: 1, time: "" },
      ],
      200,
      100,
      10,
    );
    expect(points[0].x).toBeCloseTo(10);
    expect(points[1].x).toBeCloseTo(190);
    expect(points[0].y).toBeCloseTo(50);
  });

  it("gives distances in the unit people expect", () => {
    expect(formatDistance(3218.688, "fahrenheit")).toBe("2.0 mi");
    expect(formatDistance(2500, "celsius")).toBe("2.5 km");
  });
});

describe("weather", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("describes WMO weather codes", () => {
    expect([0, 1, 2, 3, 45, 53, 63, 81, 73, 95].map(weatherKind)).toEqual([
      "clear",
      "mostly-clear",
      "partly-cloudy",
      "cloudy",
      "fog",
      "drizzle",
      "rain",
      "rain",
      "snow",
      "thunderstorm",
    ]);
  });

  it("asks the forecast service for recent hours and the archive for old ones", async () => {
    const hourly = {
      time: Array.from({ length: 24 }, (_, i) => `h${i}`),
      temperature_2m: Array(24).fill(10.6),
      weather_code: Array(24).fill(61),
    };
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({ hourly })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(weatherAt(42.3601, -71.0589, new Date(), "celsius")).resolves.toEqual({ temperature: 11, unit: "celsius", kind: "rain" });
    await weatherAt(42.3601, -71.0589, new Date("2020-06-01T15:00:00Z"), "fahrenheit");

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls[0]).toContain("https://api.open-meteo.com/v1/forecast?");
    expect(urls[1]).toContain("https://archive-api.open-meteo.com/v1/archive?");
    expect(urls[1]).toContain("start_date=2020-06-01");
    expect(urls[1]).toContain("temperature_unit=fahrenheit");
  });

  it("has no weather when the service has none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    await expect(weatherAt(0, 0, new Date(), "celsius")).resolves.toBeUndefined();
  });
});
