import { describe, expect, it } from "vitest";
import { dayRange, dayValue, drawableTracks } from "@/components/DawarichRoute/RoutePickerDialog";
import type { Track } from "@/lib/dawarich";
import { tileView } from "@/lib/routeImage";

const track = (id: number, distanceMeters: number, mode?: string, points = 3): Track => ({
  id,
  start: "2026-11-11T20:00:00Z",
  end: "2026-11-11T20:30:00Z",
  distanceMeters,
  mode,
  points: Array.from({ length: points }, (_, i) => ({ lat: 42.3 + i / 1000, lon: -71.1 })),
});

describe("route picker", () => {
  it("reads a day from the date input as local midnight to midnight", () => {
    const range = dayRange("2026-11-11");
    expect(range?.start).toEqual(new Date(2026, 10, 11));
    expect(range?.end).toEqual(new Date(2026, 10, 12));
    expect(dayRange("")).toBeUndefined();
    expect(dayValue(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("offers only journeys that moved and have a line", () => {
    const tracks = [
      track(1, 2100, "walking"),
      track(2, 12, "walking"),
      track(3, 900, "stationary"),
      track(4, 900, undefined, 1),
      track(5, 400),
    ];
    expect(drawableTracks(tracks).map((item) => item.id)).toEqual([1, 5]);
  });
});

describe("route image map", () => {
  it("zooms in as far as the route allows and covers the image with tiles", () => {
    // About 1.5 km across Boston.
    const view = tileView(
      [
        { lat: 42.355, lon: -71.07 },
        { lat: 42.36, lon: -71.055 },
      ],
      640,
      400,
    );
    expect(view.zoom).toBe(15);
    // The route sits inside the padding, centred.
    for (const point of view.path) {
      expect(point.x).toBeGreaterThanOrEqual(28);
      expect(point.x).toBeLessThanOrEqual(640 - 28);
      expect(point.y).toBeGreaterThanOrEqual(28);
      expect(point.y).toBeLessThanOrEqual(400 - 28);
    }
    expect((view.path[0].x + view.path[1].x) / 2).toBeCloseTo(320);
    // Every pixel of the image is under some tile.
    const covered = (x: number, y: number) =>
      view.tiles.some((tile) => x >= tile.left && x < tile.left + 256 && y >= tile.top && y < tile.top + 256);
    for (const [x, y] of [
      [0, 0],
      [639, 0],
      [0, 399],
      [639, 399],
      [320, 200],
    ]) {
      expect(covered(x, y)).toBe(true);
    }
    expect(view.tiles.length).toBeLessThanOrEqual(12);
  });

  it("wraps tiles across the date line", () => {
    const view = tileView(
      [
        { lat: 0, lon: 179.99 },
        { lat: 0.01, lon: 179.995 },
      ],
      640,
      400,
    );
    const count = 2 ** view.zoom;
    expect(view.tiles.every((tile) => tile.x >= 0 && tile.x < count)).toBe(true);
  });
});
