import type { Editor, Extension } from "@usememos/editor";
import "./colourTags.css";
import { colourTagDecorations, deleteAcrossColourTags } from "./textColours";

const deleting =
  (direction: "backward" | "forward") =>
  ({ editor }: { editor: Editor }) => {
    const next = deleteAcrossColourTags(editor.state, direction);
    return next ? editor.run(() => next) : false;
  };

/**
 * The formatted editor shows text colours and highlights as coloured words, never as the
 * `<span data-color>` / `<span data-highlight>` tags they're saved as (see textColours.ts).
 * Source mode still shows the tags.
 */
export const colourTags = (): Extension => ({
  name: "colour-tags",
  decorations: colourTagDecorations,
  keymap: {
    Backspace: deleting("backward"),
    Delete: deleting("forward"),
  },
});
