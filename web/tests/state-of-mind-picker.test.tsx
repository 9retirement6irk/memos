import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { StateOfMindPicker } from "@/components/Journal/StateOfMindPicker";
import { emptyMind, type StateOfMind } from "@/lib/journal/mood";

vi.mock("@/utils/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/i18n")>()),
  useTranslate: () => (key: string) => key,
}));

const Harness = ({ onChange, hiddenImpacts }: { onChange: (mind: StateOfMind) => void; hiddenImpacts?: string[] }) => {
  const [mind, setMind] = useState(emptyMind());
  return (
    <StateOfMindPicker
      value={mind}
      defaultKind="now"
      hiddenImpacts={hiddenImpacts}
      onChange={(next) => {
        setMind(next);
        onChange(next);
      }}
    />
  );
};

describe("StateOfMindPicker", () => {
  it("asks the slider first, then offers words and causes", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} hiddenImpacts={["dating"]} />);
    expect(screen.getByText("journal.mind.question-now")).toBeInTheDocument();
    expect(screen.queryByText("journal.mind.feelings")).toBeNull();

    fireEvent.change(screen.getByRole("slider"), { target: { value: "5" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ valence: "pleasant" }));
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "journal.valence.pleasant");

    fireEvent.click(screen.getByRole("button", { name: "journal.feeling.grateful" }));
    fireEvent.click(screen.getByRole("button", { name: "journal.impact.work" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ feelings: ["grateful"], impacts: ["work"] }));
    // A hidden cause isn't offered.
    expect(screen.queryByRole("button", { name: "journal.impact.dating" })).toBeNull();
  });

  it("chooses Neutral with a click on the untouched slider, and switches to the day's mood", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("slider"));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ valence: "neutral" }));

    fireEvent.click(screen.getByRole("button", { name: "journal.kind.today" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "today" }));
    expect(screen.getByText("journal.mind.question-today")).toBeInTheDocument();
  });

  it("shows every feeling word on request", () => {
    render(<Harness onChange={vi.fn()} />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "0" } });
    expect(screen.queryByRole("button", { name: "journal.feeling.joyful" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "journal.mind.feelings-all" }));
    expect(screen.getByRole("button", { name: "journal.feeling.joyful" })).toBeInTheDocument();
  });
});
