import { type EditorState, parseMarkdown, serializeMarkdown } from "@usememos/editor";
import { describe, expect, it } from "vitest";
import { applyTextStyle, type StyleKind, textStyleAt } from "@/components/MemoEditor/edit/textColours";

const OPTIONS = { breaks: true } as const;

/** A document of blocks split by blank lines, with the text between ⟦ and ⟧ selected (the brackets removed). */
const select = (markdown: string): EditorState => {
  const doc = parseMarkdown(markdown.replace("⟦", "").replace("⟧", ""), OPTIONS);
  const blocks = markdown.split("\n\n");
  // An offset in the block's own text (its parsed spans, not its Markdown), found with a private-use marker.
  const offsetIn = (index: number, marker: string, other: string) => {
    const parsed = parseMarkdown(blocks[index].replace(other, "").replace(marker, "\uE000"), OPTIONS).blocks[0];
    const text = "content" in parsed ? parsed.content.map((span) => span.text).join("") : "";
    return text.indexOf("\uE000");
  };
  const startBlock = blocks.findIndex((block) => block.includes("⟦"));
  const endBlock = blocks.findIndex((block) => block.includes("⟧"));
  return {
    doc,
    storedMarks: null,
    selection: {
      anchor: { blockId: doc.blocks[startBlock].id, offset: offsetIn(startBlock, "⟦", "⟧") },
      focus: { blockId: doc.blocks[endBlock].id, offset: offsetIn(endBlock, "⟧", "⟦") },
    },
  };
};

const apply = (markdown: string, kind: StyleKind, value: string | null) => {
  const next = applyTextStyle(select(markdown), kind, value);
  return next ? serializeMarkdown(next.doc, OPTIONS).trimEnd() : null;
};

describe("applyTextStyle", () => {
  it("wraps the selected words in a colour or highlight span", () => {
    expect(apply("a ⟦red⟧ word", "color", "red")).toBe('a <span data-color="red">red</span> word');
    expect(apply("a ⟦bright⟧ word", "highlight", "yellow")).toBe('a <span data-highlight="yellow">bright</span> word');
  });

  it("recolours a coloured run instead of nesting a second span", () => {
    expect(apply('a <span data-color="red">⟦red⟧</span> word', "color", "blue")).toBe('a <span data-color="blue">red</span> word');
  });

  it("splits a run when only part of it changes", () => {
    expect(apply('<span data-color="red">ab⟦cd⟧ef</span>', "color", "blue")).toBe(
      '<span data-color="red">ab</span><span data-color="blue">cd</span><span data-color="red">ef</span>',
    );
  });

  it("keeps a colour and a highlight on the same words in one span", () => {
    expect(apply('<span data-color="red">⟦both⟧</span>', "highlight", "green")).toBe(
      '<span data-color="red" data-highlight="green">both</span>',
    );
  });

  it("takes a colour away, leaving the highlight", () => {
    expect(apply('<span data-color="red" data-highlight="green">⟦both⟧</span>', "color", null)).toBe(
      '<span data-highlight="green">both</span>',
    );
    expect(apply('x <span data-color="red">⟦red⟧</span> y', "color", null)).toBe("x red y");
  });

  it("keeps bold, italic and links, with the span inside the formatting", () => {
    expect(apply("**⟦bold⟧**", "color", "red")).toBe('**<span data-color="red">bold</span>**');
    // Partly bold: one span for the run, with the bold inside it, so the tags nest properly.
    expect(apply("**bo⟦ld** pla⟧in", "color", "red")).toBe('**bo**<span data-color="red">**ld** pla</span>in');
    expect(apply("[⟦li⟧](https://example.com)", "color", "red")).toBe('[<span data-color="red">li</span>](https://example.com)');
  });

  it("colours each block of a selection across lines", () => {
    expect(apply("one ⟦two\n\nthree⟧ four", "color", "red")).toBe(
      'one <span data-color="red">two</span>\n\n<span data-color="red">three</span> four',
    );
  });

  it("leaves other HTML alone", () => {
    expect(apply("<kbd>⟦Ctrl⟧</kbd>", "color", "red")).toBe('<kbd><span data-color="red">Ctrl</span></kbd>');
  });

  it("does nothing without selected text", () => {
    expect(apply("a ⟦⟧ word", "color", "red")).toBeNull();
  });

  it("reports the colour where the selection starts", () => {
    expect(textStyleAt(select('a <span data-color="red" data-highlight="yellow">⟦red⟧</span>'))).toEqual({
      color: "red",
      highlight: "yellow",
    });
    expect(textStyleAt(select("a ⟦plain⟧ word"))).toEqual({});
  });
});
