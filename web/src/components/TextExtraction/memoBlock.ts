const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Text read from a file, as a collapsed section of a memo: a `<details>` block titled with the file's name, the text
 * inside it as a plain code block. Stock Memos shows both. The code block keeps the text exactly as read, line breaks
 * included, and keeps a `#word` in it from becoming a tag; its fence is longer than any run of backticks in the text.
 */
export const textBlock = (summary: string, text: string): string => {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `<details>\n<summary>${escapeHtml(summary)}</summary>\n\n${fence}text\n${text.trim()}\n${fence}\n\n</details>`;
};

/** The memo's content with the block added at the end, after a blank line. */
export const appendBlock = (content: string, block: string): string => {
  const kept = content.trimEnd();
  return kept ? `${kept}\n\n${block}\n` : `${block}\n`;
};
