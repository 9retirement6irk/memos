import type { DrawingContent } from "./drawing";

/**
 * One page of the drawing sheet. Pages are the memo's drawings, each its own
 * `.canvas.png` attachment, in the memo's attachment order: nothing else records
 * that they belong together, so stock Memos shows the same files as separate drawings.
 */
export interface DrawingPage {
  /**
   * The host's name for the page: a saved attachment's name, a draft file's preview URL,
   * or, for a page added in the sheet, a key from `newPageKey`.
   */
  key: string;
  /** The page's content, already read. */
  content?: DrawingContent;
  /** Reads the content the first time the page is shown. With neither, the page starts blank. */
  load?: (signal: AbortSignal) => Promise<DrawingContent>;
}

/** What Done hands the host. */
export interface DrawingPagesResult {
  /** Every page's key in the sheet's order, added pages included. */
  order: string[];
  /** The finished drawing of each page that changed, and of each added page drawn on. */
  files: { key: string; file: File }[];
}

const NEW_PAGE_PREFIX = "drawing-page:new:";

let newPageCount = 0;

/** A key for a page added in the sheet; no attachment or preview URL looks like it. */
export const newPageKey = (): string => `${NEW_PAGE_PREFIX}${++newPageCount}`;

export const isNewPageKey = (key: string): boolean => key.startsWith(NEW_PAGE_PREFIX);

/**
 * Places added pages in an attachment order. `order` lists the memo's attachments (keys
 * as the host names them); `pages` is the sheet's page order in the same keys, with each
 * added page under its new key. An added page lands right after the page before it in
 * the sheet, or, as the first page, right before the page after it; with no saved page
 * in the order at all, added pages go at the end. Everything else keeps its place.
 */
export function placeNewPages(order: readonly string[], pages: readonly string[], isNew: (key: string) => boolean): string[] {
  const result = order.filter((key) => !isNew(key));
  pages.forEach((key, index) => {
    if (!isNew(key)) return;
    for (let before = index - 1; before >= 0; before--) {
      const at = result.indexOf(pages[before]);
      if (at >= 0) {
        result.splice(at + 1, 0, key);
        return;
      }
    }
    for (let after = index + 1; after < pages.length; after++) {
      const at = result.indexOf(pages[after]);
      if (at >= 0) {
        result.splice(at, 0, key);
        return;
      }
    }
    result.push(key);
  });
  return result;
}
