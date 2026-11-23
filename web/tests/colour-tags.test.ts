import { Editor } from "@usememos/editor";
import { afterEach, describe, expect, it } from "vitest";
import { colourTags } from "@/components/MemoEditor/edit/colourTags";
import { deleteAcrossColourTags } from "@/components/MemoEditor/edit/textColours";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.innerHTML = "";
});

const create = (content: string) => {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({ element, content, markdown: { breaks: true }, sanitizeHtml: (tree) => tree, extensions: [colourTags()] });
  return editor;
};

/** Puts the caret, or selects [from, to), in block `block`. */
const select = (instance: Editor, from: number, to = from, block = 0) => {
  const blockId = instance.state.doc.blocks[block].id;
  instance.focus();
  instance.setSelection({ anchor: { blockId, offset: from }, focus: { blockId, offset: to } });
};

/** Runs the command as the key would, and returns the Markdown, or null when the key is left to the editor. */
const press = (instance: Editor, direction: "backward" | "forward") => {
  const next = deleteAcrossColourTags(instance.state, direction);
  if (!next) return null;
  instance.run(() => next);
  return instance.getMarkdown().trim();
};

const OPEN = '<span data-color="red">';
const CLOSE = "</span>";

describe("colour tags in the formatted editor", () => {
  it("hides the tags and colours the words while the caret is in them", () => {
    const instance = create(`a <span data-highlight="blue">Make it</span> b`);
    select(instance, 32);
    const tags = instance.root.querySelectorAll(".memo-colour-tag");
    expect(tags).toHaveLength(2);
    expect(tags[0].textContent).toBe('<span data-highlight="blue">');
    expect(tags[1].textContent).toBe(CLOSE);
    const run = instance.root.querySelector(".memo-colour-run");
    expect(run).toHaveAttribute("data-highlight", "blue");
    expect(run?.textContent).toBe("Make it");
    // Nothing changes in what's saved.
    expect(instance.getMarkdown().trim()).toBe(`a <span data-highlight="blue">Make it</span> b`);
  });

  it("leaves other HTML alone", () => {
    const instance = create("a <kbd>Ctrl</kbd> b");
    select(instance, 8);
    expect(instance.root.querySelector(".memo-colour-tag")).toBeNull();
  });

  it("Backspace after a coloured word deletes its last letter, not the closing tag", () => {
    const instance = create(`a ${OPEN}bc${CLOSE} d`);
    select(instance, 2 + OPEN.length + 2 + CLOSE.length);
    expect(press(instance, "backward")).toBe(`a ${OPEN}b${CLOSE} d`);
  });

  it("drops both tags when the last coloured letter goes", () => {
    const instance = create(`a ${OPEN}b${CLOSE}`);
    select(instance, 2 + OPEN.length + 1 + CLOSE.length);
    expect(press(instance, "backward")).toBe("a");
  });

  it("Delete before a coloured word deletes its first letter, not the opening tag", () => {
    const instance = create(`a ${OPEN}bc${CLOSE} d`);
    select(instance, 2);
    expect(press(instance, "forward")).toBe(`a ${OPEN}c${CLOSE} d`);
  });

  it("deleting a selection across a tag keeps the colour spans whole", () => {
    const instance = create(`a ${OPEN}bc${CLOSE} de`);
    // From between b and c to between d and e: the closing tag is in the selection.
    select(instance, 2 + OPEN.length + 1, 2 + OPEN.length + 2 + CLOSE.length + 2);
    expect(press(instance, "backward")).toBe(`a ${OPEN}b${CLOSE}e`);
  });

  it("Backspace at the start of a line that opens with colour joins the lines, tags and all", () => {
    const instance = create(`one\n\n${OPEN}two${CLOSE}`);
    select(instance, OPEN.length, OPEN.length, 1);
    expect(press(instance, "backward")).toBe(`one${OPEN}two${CLOSE}`);
  });

  it("leaves keys away from colour tags to the editor", () => {
    const instance = create(`ab ${OPEN}c${CLOSE}`);
    select(instance, 2);
    expect(deleteAcrossColourTags(instance.state, "backward")).toBeNull();
    select(instance, 3 + OPEN.length + 1);
    // Between the coloured letter and its closing tag, Backspace deletes the letter as usual.
    expect(deleteAcrossColourTags(instance.state, "backward")).toBeNull();
  });
});
