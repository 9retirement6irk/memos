import { type Block, type Extension, inlineText } from "@usememos/editor";

/**
 * Whether a paragraph is nothing but tags from `shown` (lowercased, without "#"): the line of
 * journal tags a journal entry ends with, which the state of mind panel draws instead.
 */
export function isJournalTagLine(block: Block, shown: ReadonlySet<string>): boolean {
  if (block.type !== "paragraph" || shown.size === 0) return false;
  const words = inlineText(block.content).trim().split(/\s+/);
  return words[0] !== "" && words.every((word) => word.startsWith("#") && shown.has(word.slice(1).toLowerCase()));
}

/**
 * Hides a memo's line of journal tags where the state of mind panel stands for them. Only that
 * line: journal tags written among other words stay where they are. The memo's Markdown is not
 * changed. `getShown` is read when the editor draws a block; `editor.refreshViews("journalTagLines")`
 * applies a change.
 */
export const journalTagLinesExtension = (getShown: () => ReadonlySet<string>): Extension => ({
  name: "journalTagLines",
  blockView: {
    match: (block) => isJournalTagLine(block, getShown()),
    render: (_block, element) => {
      element.setAttribute("data-journal-tags", "");
      element.hidden = true;
    },
  },
});
