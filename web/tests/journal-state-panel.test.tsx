import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Editor } from "@usememos/editor";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JournalStatePanel } from "@/components/Journal/JournalStatePanel";
import { isJournalTagLine, journalTagLinesExtension } from "@/components/MemoEditor/view/journalTagLines";
import { MemoContentView } from "@/components/MemoEditor/view/MemoContentView";
import { defaultJournalSettings } from "@/lib/journal/settings";
import { journalState } from "@/lib/journal/state";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ userTagsSetting: undefined, userGeneralSetting: { theme: "default" } }),
}));
vi.mock("@/contexts/MemoFilterContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/MemoFilterContext")>()),
  useMemoFilterContext: () => ({ getFiltersByFactor: () => [], addFilter: vi.fn(), removeFilter: vi.fn() }),
}));
vi.mock("@/hooks/useDevicePreferences", () => ({
  useDevicePreferences: () => ({ linkPreview: false, doubleClickEdit: false }),
}));
vi.mock("@/contexts/MentionResolutionContext", () => ({ useResolvedMentionUsernames: () => new Set<string>() }));
vi.mock("@/hooks/useNavigateTo", () => ({ default: () => vi.fn() }));

const settings = defaultJournalSettings((id) => id[0].toUpperCase() + id.slice(1));
const TAGS = ["mood/pleasant", "mood/today", "felt/grateful", "felt/calm", "impact/family", "did/reading", "did/baking", "trip"];

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.innerHTML = "";
});

describe("journalState", () => {
  it("gathers the mood, feelings, causes and activities the tags record", () => {
    const state = journalState(TAGS, settings);
    expect(state?.mind.valence).toBe("pleasant");
    expect(state?.mind.kind).toBe("today");
    expect(state?.moodTag).toBe("mood/pleasant");
    expect(state?.feelings.map((item) => item.id)).toEqual(["grateful", "calm"]);
    expect(state?.impacts).toEqual([{ id: "family", tag: "impact/family" }]);
    // A known activity keeps its label and icon; one not in the settings still shows.
    expect(state?.activities).toEqual([
      { id: "reading", tag: "did/reading", label: "Reading", icon: "book-open" },
      { id: "baking", tag: "did/baking", label: "baking", icon: "star" },
    ]);
    expect(new Set(state?.shownTags)).toEqual(new Set(TAGS.filter((tag) => tag !== "trip")));
  });

  it("leaves tags it does not know, and memos without journal tags, alone", () => {
    expect(journalState(["trip", "felt/nonsense", "impact/unknown", "mood/sub/deep"], settings)).toBeNull();
    const state = journalState(["felt/nonsense", "felt/calm"], settings);
    expect(state?.feelings.map((item) => item.id)).toEqual(["calm"]);
    expect(state?.shownTags).toEqual(["felt/calm"]);
  });

  it("follows the prefixes in the settings, ignoring case", () => {
    const state = journalState(["Feeling/Calm", "felt/sad"], { ...settings, feelingTagPrefix: "feeling" });
    expect(state?.feelings).toEqual([{ id: "calm", tag: "Feeling/Calm" }]);
    expect(state?.shownTags).toEqual(["feeling/calm"]);
  });
});

describe("the line of journal tags", () => {
  const shown = new Set(["mood/pleasant", "mood/today", "felt/calm"]);
  const create = (content: string) => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    editor = new Editor({
      element,
      content,
      editable: false,
      markdown: { breaks: true },
      sanitizeHtml: (tree) => tree,
      extensions: [journalTagLinesExtension(() => shown)],
    });
    return editor;
  };

  it("hides a paragraph of nothing but the panel's tags, and keeps the Markdown", () => {
    const content = "Went for a walk.\n\n#mood/pleasant #mood/today #felt/calm";
    const instance = create(content);
    expect(isJournalTagLine(instance.state.doc.blocks[1], shown)).toBe(true);
    const hidden = instance.root.querySelectorAll("[data-journal-tags]");
    expect(hidden).toHaveLength(1);
    expect((hidden[0] as HTMLElement).hidden).toBe(true);
    expect(instance.getMarkdown().trim()).toBe(content);
  });

  it("keeps lines with other words or other tags", () => {
    const instance = create("Calm today #felt/calm\n\n#felt/calm #trip\n\n#mood/pleasant");
    const [words, mixed, alone] = instance.state.doc.blocks;
    expect(isJournalTagLine(words, shown)).toBe(false);
    expect(isJournalTagLine(mixed, shown)).toBe(false);
    expect(isJournalTagLine(alone, shown)).toBe(true);
    expect(isJournalTagLine(alone, new Set())).toBe(false);
  });

  it("hides the line in a memo's content view only when given its tags", async () => {
    const content = "Went for a walk.\n\n#mood/pleasant #felt/calm";
    const { container, rerender } = render(
      <MemoryRouter>
        <MemoContentView content={content} memoName="memos/1" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(container.textContent).toContain("Went for a walk."));
    expect(container.querySelector("[data-journal-tags]")).toBeNull();
    rerender(
      <MemoryRouter>
        <MemoContentView content={content} memoName="memos/1" journalTags={["mood/pleasant", "felt/calm"]} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(container.querySelector("[data-journal-tags]")).not.toBeNull());
    rerender(
      <MemoryRouter>
        <MemoContentView content={content} memoName="memos/1" journalTags={[]} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(container.querySelector("[data-journal-tags]")).toBeNull());
    expect(container.textContent).toContain("#felt/calm");
  });
});

describe("JournalStatePanel", () => {
  it("draws the scale, feelings, causes and activities, each filtering by its tag", () => {
    const state = journalState(TAGS, settings);
    if (!state) throw new Error("no state");
    const onTagClick = vi.fn();
    const { container } = render(<JournalStatePanel state={state} onTagClick={onTagClick} />);
    const panel = container.querySelector('[data-slot="journal-state"]');
    expect(panel).not.toBeNull();
    expect(container.querySelectorAll("[data-journal-scale] > [data-step]")).toHaveLength(7);
    expect(container.querySelector("[data-journal-scale] > [data-chosen]")).toHaveAttribute("data-step", "pleasant");
    expect(container.querySelectorAll("[data-journal-tile]")).toHaveLength(2);
    expect(container.querySelectorAll("button")).toHaveLength(1 + 2 + 1 + 2);
    fireEvent.click(screen.getByRole("button", { name: "Reading" }));
    expect(onTagClick).toHaveBeenCalledWith("did/reading");
  });

  it("shows plain items without a click handler", () => {
    const state = journalState(["felt/calm"], settings);
    if (!state) throw new Error("no state");
    const { container } = render(<JournalStatePanel state={state} />);
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("[data-journal-scale]")).toBeNull();
  });
});
