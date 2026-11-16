import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RoutePickerDialog from "@/components/DawarichRoute/RoutePickerDialog";
import type { Track } from "@/lib/dawarich";

const mocks = vi.hoisted(() => ({ tracks: [] as Track[] }));

vi.mock("@/hooks/useDawarichQueries", () => ({
  useDawarichTracks: () => ({ data: { tracks: mocks.tracks }, isLoading: false, error: null }),
}));
vi.mock("@/hooks/useJournalQueries", () => ({ useJournalSettings: () => ({ settings: { temperatureUnit: "celsius" } }) }));
vi.mock("@/lib/dawarich", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dawarich")>()),
  getRoute: vi.fn(async () => ({ points: [], distanceMeters: 0 })),
}));
vi.mock("@/lib/routeImage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/routeImage")>()),
  drawRouteImage: vi.fn(async () => undefined),
}));
vi.mock("@/utils/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/i18n")>()),
  useTranslate: () => (key: string) => key,
}));

const track = (id: number, mode: string): Track => ({
  id,
  start: "2026-11-11T20:00:00Z",
  end: "2026-11-11T20:30:00Z",
  distanceMeters: 2100,
  mode,
  points: [
    { lat: 42.3, lon: -71.1 },
    { lat: 42.31, lon: -71.11 },
    { lat: 42.32, lon: -71.12 },
  ],
});

const renderDialog = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RoutePickerDialog open onOpenChange={vi.fn()} onPick={vi.fn()} />
    </QueryClientProvider>,
  );

describe("RoutePickerDialog", () => {
  beforeEach(() => {
    mocks.tracks = [track(1, "walking"), track(2, "cycling")];
  });

  // The radios sit in Field.Item, which throws (Base UI error 28) without a Field.Root around
  // the group; that took the whole page down once the day's journeys had loaded.
  it("lists the whole day and each journey as one radio group", async () => {
    renderDialog();
    expect(await screen.findByRole("radiogroup")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: /dawarich\.route\.whole-day/ })).toBeInTheDocument();
  });
});
