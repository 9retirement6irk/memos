import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SpacesSection from "@/components/AppSidebar/SpacesSection";
import { DEVICE_PREFERENCES_KEY, updateDevicePreferences } from "@/hooks/useDevicePreferences";
import { buildCollectionPath, ROUTES } from "@/router/routes";

const mocks = vi.hoisted(() => ({
  selectedSpaceName: undefined as string | undefined,
  creatorUsername: "alice" as string | undefined,
  spaces: [
    { name: "spaces/journal", title: "Journal" },
    { name: "spaces/homelab", title: "Homelab" },
    { name: "spaces/x7", title: "" },
  ],
  setMobileOpen: vi.fn(),
}));

vi.mock("@/contexts/SpaceContext", () => ({
  useSpaceContext: () => ({ spaces: mocks.spaces, selectedSpaceName: mocks.selectedSpaceName, creatorUsername: mocks.creatorUsername }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/alice", username: "alice" }) }));
vi.mock("@/contexts/AppSidebarContext", () => ({ useAppSidebar: () => ({ setMobileOpen: mocks.setMobileOpen }) }));
vi.mock("@/components/SpaceIcon", () => ({ default: () => <span data-testid="space-icon" /> }));
vi.mock("@/utils/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/i18n")>()),
  useTranslate: () => (key: string) => key,
}));

const Where = () => <output data-testid="path">{useLocation().pathname}</output>;
const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <SpacesSection />
      <Where />
    </MemoryRouter>,
  );
const rows = () => screen.getAllByRole("button").map((row) => row.textContent);

describe("SpacesSection", () => {
  beforeEach(() => {
    window.localStorage.removeItem(DEVICE_PREFERENCES_KEY);
    mocks.selectedSpaceName = undefined;
    mocks.creatorUsername = "alice";
    mocks.setMobileOpen.mockReset();
  });

  it("lists Home and every Space under a Spaces heading, with Home as the current place on your own memos", () => {
    renderAt(ROUTES.HOME);
    expect(screen.getByText("space.spaces")).toBeInTheDocument();
    // A Space without a title shows its id.
    expect(rows()).toEqual(["common.home", "Journal", "Homelab", "x7"]);
    expect(screen.getByRole("button", { name: "common.home" })).toHaveAttribute("data-current");
    expect(screen.getAllByTestId("space-icon")).toHaveLength(3);
  });

  it("moves the page to the Space clicked, and back to your own memos with Home", () => {
    const { unmount } = renderAt(ROUTES.HOME);
    fireEvent.click(screen.getByRole("button", { name: "Homelab" }));
    expect(screen.getByTestId("path")).toHaveTextContent(buildCollectionPath(ROUTES.HOME, "spaces/homelab"));
    expect(mocks.setMobileOpen).toHaveBeenCalledWith(false);
    unmount();

    mocks.selectedSpaceName = "spaces/homelab";
    renderAt(buildCollectionPath(ROUTES.HOME, "spaces/homelab"));
    expect(screen.getByRole("button", { name: "Homelab" })).toHaveAttribute("data-current");
    expect(screen.getByRole("button", { name: "common.home" })).not.toHaveAttribute("data-current");
    fireEvent.click(screen.getByRole("button", { name: "common.home" }));
    expect(screen.getByTestId("path")).toHaveTextContent(buildCollectionPath(ROUTES.HOME, undefined));
  });

  it("leaves out the Spaces switched off in Preferences, but still shows the one you are in", () => {
    updateDevicePreferences({ hiddenSidebarSpaces: ["spaces/journal", "spaces/x7"] });
    const { unmount } = renderAt(ROUTES.HOME);
    expect(rows()).toEqual(["common.home", "Homelab"]);
    unmount();

    mocks.selectedSpaceName = "spaces/journal";
    renderAt(buildCollectionPath(ROUTES.HOME, "spaces/journal"));
    expect(rows()).toEqual(["common.home", "Journal", "Homelab"]);
  });

  it("is not shown when every Space is switched off", () => {
    updateDevicePreferences({ hiddenSidebarSpaces: mocks.spaces.map((space) => space.name) });
    renderAt(ROUTES.HOME);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("space.spaces")).not.toBeInTheDocument();
  });
});
