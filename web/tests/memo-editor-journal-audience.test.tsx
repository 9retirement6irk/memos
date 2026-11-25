import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoEditor, preloadMemoEditing } from "@/components/MemoEditor";
import { cacheService } from "@/components/MemoEditor/edit/services";

const mocks = vi.hoisted(() => ({ journalSpace: undefined as string | undefined }));

// The journal settings arrive from the server after the composer's first render.
vi.mock("@/hooks/useJournalQueries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useJournalQueries")>();
  return {
    ...actual,
    useJournalSettings: () => {
      const result = actual.useJournalSettings();
      return { ...result, settings: { ...result.settings, space: mocks.journalSpace } };
    },
  };
});
vi.mock("@/utils/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/i18n")>()),
  useTranslate: () => (key: string) => key,
}));
vi.mock("@/hooks/useUserQueries", () => ({
  useTagCounts: () => ({ data: {} }),
  useUsersByUsernames: () => ({ data: undefined }),
  useUpdateUserEditorSetting: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/1" }) }));
vi.mock("@/contexts/AuthContext", () => ({
  // The author's own default is the narrowest audience, so anything wider below comes from where the memo is written.
  useAuth: () => ({ userGeneralSetting: { memoVisibility: "PRIVATE" }, userEditorSetting: undefined, setUserEditorSetting: vi.fn() }),
}));
vi.mock("@/lib/toast", () => ({ toast: { add: vi.fn(), close: vi.fn() }, showErrorToast: vi.fn() }));
vi.mock("@/contexts/InstanceContext", () => ({
  useInstance: () => ({ aiSetting: { providers: [], transcription: undefined }, fetchSetting: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock("@/contexts/NewMemoContext", () => ({ useNewMemo: () => ({ markNewMemo: vi.fn() }) }));
vi.mock("@/hooks/useSpaceQueries", () => ({ useSpaces: () => ({ data: [] }) }));
vi.mock("@/contexts/SpaceContext", () => ({ useSpaceContext: () => ({ selectedSpaceName: undefined }) }));
vi.mock("@/connect", () => ({ attachmentServiceClient: {}, memoServiceClient: {}, userServiceClient: {} }));
vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

beforeAll(async () => {
  // The editing session loads lazily; loaded once, it renders without suspending.
  await preloadMemoEditing();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cacheService.clearAll();
  mocks.journalSpace = undefined;
});

const JOURNAL = "spaces/journal";

const mount = (space: string) => {
  const client = new QueryClient();
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(wrap(<MemoEditor draft={{ scope: "home", space }} />));
  return {
    settle: (journalSpace: string) => {
      mocks.journalSpace = journalSpace;
      act(() => view.rerender(wrap(<MemoEditor draft={{ scope: "home", space }} />)));
    },
  };
};

const audience = (name: string) => screen.getByRole("button", { name: `memo.audience.${name}` });

/**
 * Upstream starts a memo written in a Space with the Space's members as its audience. Journal
 * entries are personal, so in the journal Space a new memo starts with the author's own default.
 */
describe("the audience a composer starts with in the journal Space", () => {
  it("is the author's default once the journal settings name this Space", () => {
    mocks.journalSpace = JOURNAL;
    mount(JOURNAL);
    expect(audience("private")).toBeInTheDocument();
  });

  it("follows the journal settings when they load after the composer opened", () => {
    const { settle } = mount(JOURNAL);
    expect(audience("space")).toBeInTheDocument();
    settle(JOURNAL);
    expect(audience("private")).toBeInTheDocument();
  });

  it("keeps an audience the author chose before the journal settings loaded", () => {
    const { settle } = mount(JOURNAL);
    fireEvent.click(audience("space"));
    const publicItem = screen.getAllByRole("menuitemradio").find((item) => item.textContent === "memo.audience.public");
    if (!publicItem) throw new Error("no public audience offered");
    fireEvent.click(publicItem);
    expect(audience("public")).toBeInTheDocument();
    settle(JOURNAL);
    expect(audience("public")).toBeInTheDocument();
  });

  it("is still the Space's members in any other Space", () => {
    mocks.journalSpace = JOURNAL;
    mount("spaces/work");
    expect(audience("space")).toBeInTheDocument();
  });
});
