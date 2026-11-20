import { Editor } from "@usememos/editor";
import { afterEach, describe, expect, it } from "vitest";
import { textColourPicker } from "@/components/MemoEditor/edit/textColourPicker";

const LABELS = {
  title: "Text color",
  colour: "Color",
  highlight: "Highlight",
  noColour: "No color",
  noHighlight: "No highlight",
  names: { red: "Red", yellow: "Yellow" },
};

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.innerHTML = "";
});

const create = (content: string) => {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({ element, content, markdown: { breaks: true }, extensions: [textColourPicker(LABELS)] });
  return editor;
};

/** Selects characters [from, to) of the first block. */
const selectFirst = (instance: Editor, from: number, to: number) => {
  const blockId = instance.state.doc.blocks[0].id;
  instance.setSelection({ anchor: { blockId, offset: from }, focus: { blockId, offset: to } });
};

describe("the text colour button", () => {
  it("sits in the formatting toolbar after the inline formats", () => {
    const instance = create("hello world");
    const toolbar =
      document.querySelector(".mbe-toolbar") ?? (instance as unknown as { toolbar: { popup: { el: HTMLElement } } }).toolbar.popup.el;
    const button = toolbar.querySelector(".memo-tool-colour");
    // If an editor upgrade moves the toolbar, this fails rather than the button silently going missing.
    expect(button).not.toBeNull();
    expect(button?.previousElementSibling?.classList.contains("mbe-tool-link")).toBe(true);
    expect(button).toHaveAttribute("aria-label", "Text color");
  });

  it("opens swatches for the colours and highlights, and colours the selection", () => {
    const instance = create("hello world");
    selectFirst(instance, 6, 11);
    const toolbar = (instance as unknown as { toolbar: { popup: { el: HTMLElement } } }).toolbar.popup.el;
    document.body.appendChild(toolbar);
    toolbar.querySelector<HTMLButtonElement>(".memo-tool-colour")?.click();

    const panel = document.querySelector<HTMLElement>(".memo-colour-panel");
    expect(panel?.hidden).toBe(false);
    // None plus nine colours, and none plus five highlights.
    expect(panel?.querySelectorAll('[data-kind="color"]')).toHaveLength(10);
    expect(panel?.querySelectorAll('[data-kind="highlight"]')).toHaveLength(6);
    expect(panel?.querySelector('[data-kind="color"][data-value=""]')).toHaveAttribute("aria-pressed", "true");

    panel?.querySelector<HTMLButtonElement>('[data-kind="color"][data-value="red"]')?.click();
    expect(instance.getMarkdown().trim()).toBe('hello <span data-color="red">world</span>');
    expect(panel?.hidden).toBe(true);

    // The same words are still selected: a highlight joins the colour, and the panel shows both.
    toolbar.querySelector<HTMLButtonElement>(".memo-tool-colour")?.click();
    expect(panel?.querySelector('[data-kind="color"][data-value="red"]')).toHaveAttribute("aria-pressed", "true");
    panel?.querySelector<HTMLButtonElement>('[data-kind="highlight"][data-value="yellow"]')?.click();
    expect(instance.getMarkdown().trim()).toBe('hello <span data-color="red" data-highlight="yellow">world</span>');

    // One Undo takes back one choice.
    instance.commands.undo();
    expect(instance.getMarkdown().trim()).toBe('hello <span data-color="red">world</span>');
  });

  it("closes with Escape, and goes away with the editor", () => {
    const instance = create("hello world");
    selectFirst(instance, 0, 5);
    const toolbar = (instance as unknown as { toolbar: { popup: { el: HTMLElement } } }).toolbar.popup.el;
    document.body.appendChild(toolbar);
    toolbar.querySelector<HTMLButtonElement>(".memo-tool-colour")?.click();
    const panel = document.querySelector<HTMLElement>(".memo-colour-panel");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panel?.hidden).toBe(true);
    instance.destroy();
    expect(document.querySelector(".memo-colour-panel")).toBeNull();
    expect(document.querySelector(".memo-tool-colour")).toBeNull();
    editor = null;
  });
});
