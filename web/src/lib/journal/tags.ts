/** Tags as Memos accepts them, built from labels and the user's prefixes. */

/** A tag segment from a label: lowercase, words joined by "-", only characters tags allow. */
export const tagSegment = (label: string): string =>
  label
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s/]+/g, "-")
    .replace(/[^\p{L}\p{N}_\-+&]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

/** A tag prefix as the user typed it, ending in one "/" when it isn't empty. */
export const normalizePrefix = (prefix: string): string => {
  const segments = prefix.split("/").map(tagSegment).filter(Boolean);
  return segments.length ? `${segments.join("/")}/` : "";
};
