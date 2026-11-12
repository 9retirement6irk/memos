import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppWindow, { packedGridWidth } from "@/components/AppWindow";

const mocks = vi.hoisted(() => ({
  user: { username: "demo" } as { username: string } | undefined,
  signOut: vi.fn(),
  title: "",
}));

vi.mock("@/hooks/useCurrentUser", () => ({ default: () => mocks.user }));
vi.mock("@/hooks/useSignOut", () => ({ useSignOut: () => mocks.signOut }));
vi.mock("@/contexts/InstanceContext", () => ({
  useInstance: () => ({ generalSetting: { customProfile: { title: mocks.title } } }),
}));
vi.mock("@/contexts/ViewContext", () => ({ useView: () => ({ maxColumns: 1 }) }));
vi.mock("@/utils/i18n", () => ({ useTranslate: () => (key: string) => key }));

const setTheme = (appearance: string) => document.documentElement.setAttribute("data-theme", appearance);

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppWindow>
        <p>page</p>
      </AppWindow>
    </MemoryRouter>,
  );

describe("AppWindow", () => {
  beforeEach(() => {
    setTheme("aero-light");
    mocks.user = { username: "demo" };
    mocks.title = "";
    mocks.signOut.mockClear();
  });

  it("adds nothing around the page outside the Aero themes", () => {
    setTheme("dark");
    const { container } = renderAt("/");
    expect(container.innerHTML).toBe("<p>page</p>");
  });

  it("frames the page in a window named after the instance", () => {
    mocks.title = "WxNotes";
    const { container } = renderAt("/setting");
    const win = container.querySelector("[data-app-window]");
    expect(win).toHaveAttribute("data-page", "settings");
    expect(win?.querySelector("[data-app-window-title]")).toHaveTextContent("WxNotes");
    expect(screen.getByText("page")).toBeInTheDocument();
  });

  it("calls the window Memos when the instance has no title", () => {
    renderAt("/");
    expect(document.querySelector("[data-app-window-title]")).toHaveTextContent("Memos");
  });

  it("signs out from the red close button", () => {
    renderAt("/");
    fireEvent.click(screen.getByRole("button", { name: "common.sign-out" }));
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it("has no close button for visitors who aren't signed in", () => {
    mocks.user = undefined;
    renderAt("/explore");
    expect(screen.queryByRole("button", { name: "common.sign-out" })).toBeNull();
  });

  it("leaves the map unframed", () => {
    const { container } = renderAt("/map");
    expect(container.querySelector("[data-app-window]")).toBeNull();
  });
});

describe("packedGridWidth", () => {
  it("packs as many 260px+ columns as fit, each at most 420px", () => {
    // 1000px fits 3 columns of 325px with two 12px gaps.
    expect(packedGridWidth(1000, 0)).toBe(3 * 325 + 2 * 12);
    // 2000px fits 7 columns; capped at 420px they need less than all of it.
    expect(packedGridWidth(2000, 0)).toBeLessThanOrEqual(2000);
  });

  it("stops at the column ceiling and caps each column at 420px", () => {
    expect(packedGridWidth(2000, 2)).toBe(2 * 420 + 12);
  });

  it("is a fixed point: the packed width packs to itself", () => {
    for (const available of [600, 913, 1280, 1777]) {
      const packed = packedGridWidth(available, 0);
      expect(packedGridWidth(packed, 0)).toBe(packed);
    }
  });
});
