import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import KindPanel from "@/components/DrawingSheet/kidpix/KindPanel";
import { KIDPIX_KINDS } from "@/components/DrawingSheet/kidpix/kinds";

const NAMES = ["Paint Brush", "Spray Can"];
const brush = KIDPIX_KINDS.brush;
const last = (cells: readonly number[]) => cells[cells.length - 1];

/** The sheet position a kind's art shows, which names the cell it is on. */
const cellOf = (name: string) => {
  const art = screen.getByRole("button", { name }).querySelector(".kidpix-kind-art")?.lastElementChild as HTMLElement;
  const [x, y] = art.style.backgroundPosition.split(" ").map((part) => Math.abs(Number.parseFloat(part)));
  return brush.cells.findIndex(([sx, sy]) => sx === x && sy === y);
};

const Panel = () => {
  const [selected, setSelected] = useState(0);
  return (
    <KindPanel
      art="brush"
      label="Wacky Brush"
      names={NAMES}
      selected={selected}
      color="#ff0080"
      onSelect={setSelected}
      play={() => undefined}
    />
  );
};

describe("the Kid Pix kinds panel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("picks the new kind up, then lays the old one down", () => {
    render(<Panel />);
    fireEvent.click(screen.getByRole("button", { name: "Spray Can" }));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(cellOf("Spray Can")).toBe(last(brush.kinds[1].pickUp));
    expect(cellOf("Paint Brush")).toBe(last(brush.kinds[0].putDown));
  });

  it("leaves a kind picked again mid-animation in hand", () => {
    render(<Panel />);
    fireEvent.click(screen.getByRole("button", { name: "Spray Can" }));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    fireEvent.click(screen.getByRole("button", { name: "Paint Brush" }));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole("button", { name: "Paint Brush" })).toHaveAttribute("aria-pressed", "true");
    expect(cellOf("Paint Brush")).toBe(last(brush.kinds[0].pickUp));
    expect(cellOf("Spray Can")).toBe(last(brush.kinds[1].putDown));
  });
});
