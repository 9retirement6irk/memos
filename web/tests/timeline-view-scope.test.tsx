import { act, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type SpaceViewOverride, TimelineViewProvider, useView } from "@/contexts/ViewContext";

const storageKey = "memos-view-setting";
const saved = { timeBasis: "update_time", orderByTimeAsc: true, maxColumns: 3, compactMode: true };
const defaults = { timeBasis: "create_time", orderByTimeAsc: false, maxColumns: 1, compactMode: false };

function Probe() {
  const { timeBasis, orderByTimeAsc, maxColumns, compactMode, setMaxColumns } = useView();
  return (
    <>
      <output>{JSON.stringify({ timeBasis, orderByTimeAsc, maxColumns, compactMode })}</output>
      <button type="button" onClick={() => setMaxColumns(2)}>
        two columns
      </button>
    </>
  );
}

function renderRoute(path: string, spaceView?: SpaceViewOverride) {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <TimelineViewProvider spaceView={spaceView}>
            <Probe />
          </TimelineViewProvider>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const settings = () => JSON.parse(screen.getByRole("status").textContent ?? "{}");

describe("Timeline display settings scope", () => {
  beforeEach(() => localStorage.setItem(storageKey, JSON.stringify(saved)));

  it.each([
    "/",
    "/explore",
    "/?creator=alice",
    "/spaces/test",
    "/spaces/test/explore",
    "/Spaces/test/Explore/",
  ])("applies saved preferences to %s", (path) => {
    renderRoute(path);
    expect(settings()).toEqual(saved);
  });

  it.each([
    "/calendar",
    "/map",
    "/archived",
    "/attachments",
    "/memos/example",
    "/memos/shares/example",
    "/spaces/test/calendar",
    "/spaces/test/map",
    "/setting",
    "/views",
  ])("keeps %s independent of Timeline preferences", (path) => {
    renderRoute(path);
    expect(settings()).toEqual(defaults);
  });

  it("restores Timeline preferences after visiting another view without overwriting storage", async () => {
    const router = renderRoute("/spaces/test?creator=alice");
    expect(settings()).toEqual(saved);
    await act(() => router.navigate("/spaces/test/calendar?creator=alice"));
    expect(settings()).toEqual(defaults);
    await act(() => router.navigate("/spaces/test?creator=alice"));
    expect(settings()).toEqual(saved);
    expect(JSON.parse(localStorage.getItem(storageKey) ?? "{}")).toEqual(saved);
  });

  it("gives the journal Space its own view and leaves Home's alone", async () => {
    const journal = { timeBasis: "create_time", orderByTimeAsc: true, maxColumns: 1, compactMode: false } as const;
    const update = vi.fn();
    const router = renderRoute("/spaces/journal", { space: "spaces/journal", state: journal, update });
    expect(settings()).toEqual(journal);

    // Changing the view there changes the journal's view, not the one saved for Home.
    await act(async () => screen.getByRole("button", { name: "two columns" }).click());
    expect(update).toHaveBeenCalledWith({ maxColumns: 2 });
    expect(JSON.parse(localStorage.getItem(storageKey) ?? "{}")).toEqual(saved);

    await act(() => router.navigate("/"));
    expect(settings()).toEqual(saved);
    await act(() => router.navigate("/spaces/test"));
    expect(settings()).toEqual(saved);
  });
});
