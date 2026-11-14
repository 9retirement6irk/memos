import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import JournalSwitchRow from "@/components/AppSidebar/JournalSwitchRow";
import { buildCollectionPath, ROUTES } from "@/router/routes";

const mocks = vi.hoisted(() => ({
  journalSpace: "spaces/journal" as string | undefined,
  selectedSpaceName: undefined as string | undefined,
  spaces: [{ name: "spaces/journal" }, { name: "spaces/homelab" }],
  setMobileOpen: vi.fn(),
}));

vi.mock("@/contexts/SpaceContext", () => ({
  useSpaceContext: () => ({ spaces: mocks.spaces, selectedSpaceName: mocks.selectedSpaceName }),
}));
vi.mock("@/hooks/useJournalQueries", () => ({
  useJournalSettings: () => ({ settings: { space: mocks.journalSpace } }),
}));
vi.mock("@/utils/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/i18n")>()),
  useTranslate: () => (key: string) => key,
}));
vi.mock("@/contexts/AppSidebarContext", () => ({
  useAppSidebar: () => ({ setMobileOpen: mocks.setMobileOpen }),
}));

const Where = () => <output data-testid="path">{useLocation().pathname}</output>;

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <JournalSwitchRow />
      <Where />
    </MemoryRouter>,
  );

describe("JournalSwitchRow", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.journalSpace = "spaces/journal";
    mocks.selectedSpaceName = undefined;
    mocks.setMobileOpen.mockReset();
  });

  it("is hidden until a journal Space is chosen", () => {
    mocks.journalSpace = undefined;
    renderAt(ROUTES.HOME);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("is hidden when the chosen journal Space no longer exists", () => {
    mocks.journalSpace = "spaces/deleted";
    renderAt(ROUTES.HOME);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("opens the journal Space from your notes, and closes the mobile sidebar", () => {
    renderAt(ROUTES.HOME);
    fireEvent.click(screen.getByRole("button", { name: "journal.sidebar.journal" }));
    expect(screen.getByTestId("path")).toHaveTextContent(buildCollectionPath(ROUTES.HOME, "spaces/journal"));
    expect(mocks.setMobileOpen).toHaveBeenCalledWith(false);
  });

  it("reads Notes in the journal and goes back to the Space you came from", () => {
    // Seen outside the journal first: Homelab is remembered.
    mocks.selectedSpaceName = "spaces/homelab";
    const { unmount } = renderAt(buildCollectionPath(ROUTES.HOME, "spaces/homelab"));
    unmount();

    mocks.selectedSpaceName = "spaces/journal";
    renderAt(buildCollectionPath(ROUTES.HOME, "spaces/journal"));
    fireEvent.click(screen.getByRole("button", { name: "journal.sidebar.notes" }));
    expect(screen.getByTestId("path")).toHaveTextContent(buildCollectionPath(ROUTES.HOME, "spaces/homelab"));
  });

  it("goes back to all memos when there is no Space to return to", () => {
    mocks.selectedSpaceName = "spaces/journal";
    window.localStorage.setItem("memos-journal-return-space", "spaces/deleted");
    renderAt(buildCollectionPath(ROUTES.HOME, "spaces/journal"));
    fireEvent.click(screen.getByRole("button", { name: "journal.sidebar.notes" }));
    expect(screen.getByTestId("path")).toHaveTextContent(buildCollectionPath(ROUTES.HOME, undefined));
  });
});
