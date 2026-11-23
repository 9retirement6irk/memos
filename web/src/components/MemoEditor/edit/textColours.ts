import {
  type Block,
  type Cell,
  commands,
  containerContent,
  type Decoration,
  type Decorator,
  type EditorState,
  type Inline,
  isPlainTextBlock,
  MARK_ORDER,
  type Mark,
  normalizeInline,
  type Span,
  withContainerContent,
} from "@usememos/editor";

/**
 * Text colours and highlights in the composer. Markdown has no colour, so a coloured run is
 * raw HTML that memos keeps (`web/src/text-colours.css` draws it, and GZreader writes the same):
 *
 *   <span data-color="red">words</span>
 *   <span data-highlight="yellow">words</span>
 *   <span data-color="red" data-highlight="yellow">words</span>
 *
 * The editor holds each tag as a span with the `html` mark. Applying a colour works on characters, not tags:
 * every character gets its colour and highlight from the spans around it, the selection's change, and the
 * block's colour spans are written again from scratch, one span per run of the same colour and highlight, so
 * they never overlap or nest badly however often the text is recoloured.
 */

export const TEXT_COLOURS = ["gray", "red", "orange", "yellow", "green", "aqua", "blue", "purple", "pink"] as const;
export const HIGHLIGHT_COLOURS = ["yellow", "green", "blue", "pink", "orange"] as const;
export type TextColour = (typeof TEXT_COLOURS)[number];
export type HighlightColour = (typeof HIGHLIGHT_COLOURS)[number];

export type StyleKind = "color" | "highlight";
export interface TextStyle {
  color?: string;
  highlight?: string;
}

/** An opening tag that is ours: a span with only data-color and data-highlight attributes. */
const OURS = /^<span((?:\s+data-(?:color|highlight)="[a-z]+")+)\s*>$/;
const ATTRIBUTE = /data-(color|highlight)="([a-z]+)"/g;
const SPAN_OPEN = /^<span(?:\s[^>]*)?>$/i;
const SPAN_CLOSE = /^<\/span\s*>$/i;
/** A tag, or the text between tags (a comment's, say), in one `html` span. */
const HTML_PIECE = /<[^>]*>|[^<]+/g;

/** One character of text, one atom (image, token), or one HTML tag that isn't ours, with what it looks like. */
interface Unit {
  span: Omit<Span, "text">;
  text: string;
  style: TextStyle;
  /** HTML that isn't a colour span: kept where it is, never merged into a colour run's tags. */
  html: boolean;
  /** The unit's start in the block's text before the change, to find the selection. */
  from: number;
}

const styleKey = (style: TextStyle) => `${style.color ?? ""}|${style.highlight ?? ""}`;

const openTag = (style: TextStyle) => {
  const attributes = [style.color && `data-color="${style.color}"`, style.highlight && `data-highlight="${style.highlight}"`].filter(
    Boolean,
  );
  return `<span ${attributes.join(" ")}>`;
};

/** Where one of our colour tags sits in a block's text. */
interface TagRange {
  from: number;
  to: number;
}

/**
 * The block's content as units, with the colour spans taken out and turned into each unit's style.
 * `tags`, when given, collects where the colour tags that were taken out sat: an opening tag of ours and
 * the closing tag that pairs with it.
 */
const toUnits = (content: Inline, tags?: TagRange[]): Unit[] => {
  const units: Unit[] = [];
  // Open spans, innermost last: ours carry a style, others (null) only keep their closing tag paired.
  const open: (TextStyle | null)[] = [];
  const current = (): TextStyle => Object.assign({}, ...open.filter(Boolean));
  let offset = 0;
  for (const { text, ...span } of content) {
    if (span.marks.includes("html")) {
      for (const match of text.matchAll(HTML_PIECE)) {
        const piece = match[0];
        const at = offset + (match.index ?? 0);
        const ours = OURS.exec(piece);
        if (ours) {
          tags?.push({ from: at, to: at + piece.length });
          const style: TextStyle = {};
          for (const [, kind, value] of ours[1].matchAll(ATTRIBUTE)) style[kind as StyleKind] = value;
          open.push(style);
          continue;
        }
        if (SPAN_CLOSE.test(piece) && open.length > 0) {
          if (open.pop() !== null) {
            tags?.push({ from: at, to: at + piece.length });
            continue;
          }
        } else if (SPAN_OPEN.test(piece)) {
          open.push(null);
        }
        units.push({ span, text: piece, style: current(), html: true, from: at });
      }
    } else if (span.image || span.token) {
      units.push({ span, text, style: current(), html: false, from: offset });
    } else {
      for (let i = 0; i < text.length; i += 1) units.push({ span, text: text[i], style: current(), html: false, from: offset + i });
    }
    offset += text.length;
  }
  return units;
};

/** Marks every unit of a run shares, in the editor's order, for its colour span's tags. */
const sharedSpan = (run: readonly Unit[]): Omit<Span, "text"> => {
  const marks = MARK_ORDER.filter((mark: Mark) => mark !== "html" && run.every((unit) => unit.span.marks.includes(mark)));
  const first = run[0].span;
  const sameLink = run.every((unit) => unit.span.link === first.link && unit.span.linkTitle === first.linkTitle);
  return {
    marks: [...marks, "html"],
    ...(sameLink && first.link !== undefined ? { link: first.link, linkTitle: first.linkTitle } : {}),
  };
};

/** The units as content again, with one colour span around each run of the same style. Returns the new offsets of the units. */
const fromUnits = (units: readonly Unit[]): { content: Span[]; starts: number[] } => {
  const spans: Span[] = [];
  const starts: number[] = [];
  let offset = 0;
  const push = (span: Span) => {
    spans.push(span);
    offset += span.text.length;
  };
  for (let i = 0; i < units.length; ) {
    const key = styleKey(units[i].style);
    let end = i;
    while (end < units.length && styleKey(units[end].style) === key) end += 1;
    const run = units.slice(i, end);
    const styled = key !== "|";
    const tags = styled ? sharedSpan(run) : null;
    if (tags) push({ ...tags, text: openTag(run[0].style) });
    for (const unit of run) {
      starts.push(offset);
      push({ ...unit.span, text: unit.text });
    }
    if (tags) push({ ...tags, text: "</span>" });
    i = end;
  }
  starts.push(offset);
  return { content: normalizeInline(spans), starts };
};

/** The blocks a selection touches, in order, each with the part of its text selected. One table cell at most. */
const selectedParts = (state: EditorState): { index: number; cell?: Cell; from: number; to: number }[] | null => {
  const { anchor, focus } = state.selection;
  const blocks = state.doc.blocks;
  const anchorIndex = blocks.findIndex((block) => block.id === anchor.blockId);
  const focusIndex = blocks.findIndex((block) => block.id === focus.blockId);
  if (anchorIndex < 0 || focusIndex < 0) return null;
  const forward = anchorIndex < focusIndex || (anchorIndex === focusIndex && anchor.offset <= focus.offset);
  const [start, end] = forward ? [anchor, focus] : [focus, anchor];
  const [startIndex, endIndex] = forward ? [anchorIndex, focusIndex] : [focusIndex, anchorIndex];
  if (start.cell || end.cell) {
    // Inside one table cell only: a selection across cells or out of the table has no single run to colour.
    const sameCell = startIndex === endIndex && start.cell?.row === end.cell?.row && start.cell?.col === end.cell?.col;
    return sameCell ? [{ index: startIndex, cell: start.cell, from: start.offset, to: end.offset }] : null;
  }
  const parts = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    const content = containerContent(blocks[index]);
    if (!content) continue;
    const length = content.reduce((sum, span) => sum + span.text.length, 0);
    parts.push({ index, from: index === startIndex ? start.offset : 0, to: index === endIndex ? end.offset : length });
  }
  return parts;
};

const colourable = (block: Block) => !isPlainTextBlock(block);

/**
 * Sets the selection's text colour or highlight (`null` takes it away), as one edit. Null when there is
 * nothing to change: no selected text, or text only in code, raw HTML or a section title.
 */
export const applyTextStyle = (state: EditorState, kind: StyleKind, value: string | null): EditorState | null => {
  const parts = selectedParts(state)?.filter((part) => part.to > part.from && colourable(state.doc.blocks[part.index]));
  if (!parts || parts.length === 0) return null;
  const blocks = [...state.doc.blocks];
  const moved = new Map<string, (offset: number) => number>();
  for (const { index, cell, from, to } of parts) {
    const block = blocks[index];
    const content = containerContent(block, cell);
    if (!content) continue;
    const units = toUnits(content);
    for (const unit of units) {
      if (unit.from < from || unit.from >= to) continue;
      if (value === null) delete unit.style[kind];
      else unit.style = { ...unit.style, [kind]: value };
    }
    const rebuilt = fromUnits(units);
    blocks[index] = withContainerContent(block, cell, rebuilt.content);
    // The selection keeps the same characters: an offset maps to where its unit went.
    moved.set(block.id, (offset) => {
      const at = units.findIndex((unit) => unit.from >= offset);
      return at < 0 ? rebuilt.starts[units.length] : rebuilt.starts[at];
    });
  }
  const map = (position: EditorState["selection"]["anchor"]) => ({
    ...position,
    offset: moved.get(position.blockId)?.(position.offset) ?? position.offset,
  });
  return {
    ...state,
    doc: { ...state.doc, blocks },
    selection: { anchor: map(state.selection.anchor), focus: map(state.selection.focus) },
  };
};

/** The colour and highlight where the selection starts, to show which swatch is in use. */
export const textStyleAt = (state: EditorState): TextStyle => {
  const part = selectedParts(state)?.[0];
  if (!part) return {};
  const content = containerContent(state.doc.blocks[part.index], part.cell);
  if (!content) return {};
  const unit = toUnits(content).find((candidate) => !candidate.html && candidate.from >= part.from);
  return unit?.style ?? {};
};

/* The formatted editor shows coloured words, not the tags around them. Rendered HTML already does when the
 * caret is elsewhere; when the caret touches the run the editor shows its source, so these decorations hide the
 * tags there (colourTags.css) and colour the words between them. The tags stay in the text, so a hidden tag
 * is still under the caret: Backspace and Delete next to one go through deleteAcrossColourTags, which removes
 * the word's character instead and writes the block's colour spans again, so a tag is never left half deleted.
 */

/** Hides the block's colour tags and colours the words between them. */
export const colourTagDecorations: Decorator = ({ content }) => {
  const tags: TagRange[] = [];
  const units = toUnits(content, tags);
  if (tags.length === 0) return [];
  const decorations: Decoration[] = tags.map(({ from, to }) => ({ from, to, class: "memo-colour-tag" }));
  for (let i = 0; i < units.length; ) {
    const key = styleKey(units[i].style);
    let end = i + 1;
    // One decoration per stretch of the same style with no tag inside it, so decorations never overlap.
    while (
      end < units.length &&
      styleKey(units[end].style) === key &&
      units[end].from === units[end - 1].from + units[end - 1].text.length
    ) {
      end += 1;
    }
    const { color, highlight } = units[i].style;
    if (color || highlight) {
      const last = units[end - 1];
      decorations.push({
        from: units[i].from,
        to: last.from + last.text.length,
        class: "memo-colour-run",
        attributes: { ...(color ? { "data-color": color } : {}), ...(highlight ? { "data-highlight": highlight } : {}) },
      });
    }
    i = end;
  }
  return decorations.sort((a, b) => a.from - b.from);
};

type Position = EditorState["selection"]["anchor"];

/** The block's text, units and tag ranges at a position, or null where colour tags can't be (code, raw HTML). */
const containerAt = (state: EditorState, position: Position) => {
  const index = state.doc.blocks.findIndex((block) => block.id === position.blockId);
  const block = state.doc.blocks[index];
  if (!block || !colourable(block)) return null;
  const content = containerContent(block, position.cell);
  if (!content) return null;
  const tags: TagRange[] = [];
  const units = toUnits(content, tags);
  return { index, block, content, units, tags, text: content.map((span) => span.text).join("") };
};

/** The state with the units in `[from, to)` removed from one block, and the caret where they were. */
const removeUnits = (
  state: EditorState,
  at: NonNullable<ReturnType<typeof containerAt>>,
  position: Position,
  from: number,
  to: number,
): EditorState | null => {
  const first = at.units.findIndex((unit) => unit.from >= from);
  const kept = at.units.filter((unit) => unit.from < from || unit.from >= to);
  if (first < 0 || kept.length === at.units.length) return null;
  const rebuilt = fromUnits(kept);
  const blocks = [...state.doc.blocks];
  blocks[at.index] = withContainerContent(at.block, position.cell, rebuilt.content);
  const caret = { ...position, offset: rebuilt.starts[first] };
  return { ...state, doc: { ...state.doc, blocks }, selection: { anchor: caret, focus: caret } };
};

/**
 * Backspace or Delete beside a hidden colour tag, or over a selection in one block that holds one: deletes the
 * words' characters, never part of a tag, and writes the colour spans again so none is left open or empty.
 * Null when no colour tag is involved, for the editor's own key handling.
 */
export const deleteAcrossColourTags = (state: EditorState, direction: "backward" | "forward"): EditorState | null => {
  const { anchor, focus } = state.selection;
  if (anchor.blockId !== focus.blockId || anchor.cell?.row !== focus.cell?.row || anchor.cell?.col !== focus.cell?.col) return null;
  const at = containerAt(state, anchor);
  if (!at || at.tags.length === 0) return null;
  if (anchor.offset !== focus.offset) {
    const from = Math.min(anchor.offset, focus.offset);
    const to = Math.max(anchor.offset, focus.offset);
    if (!at.tags.some((tag) => tag.from < to && tag.to > from)) return null;
    return removeUnits(state, at, { ...anchor, offset: from }, from, to);
  }
  // Step over the hidden tags beside the caret to the character the key is meant for.
  let edge = anchor.offset;
  if (direction === "backward") {
    for (let tag = at.tags.find((t) => t.to === edge); tag; tag = at.tags.find((t) => t.to === edge)) edge = tag.from;
  } else {
    for (let tag = at.tags.find((t) => t.from === edge); tag; tag = at.tags.find((t) => t.from === edge)) edge = tag.to;
  }
  if (edge === anchor.offset) return null;
  const hasCharacter = direction === "backward" ? edge > 0 : edge < at.text.length;
  if (!hasCharacter) {
    // Only tags between the caret and the block's edge: join the blocks as the key would at the edge.
    const caret = { ...anchor, offset: edge };
    const moved = { ...state, selection: { anchor: caret, focus: caret } };
    return direction === "backward" ? commands.deleteBackward(moved) : commands.deleteForward(moved);
  }
  const [from, to] =
    direction === "backward" ? [commands.previousGrapheme(at.text, edge), edge] : [edge, commands.nextGrapheme(at.text, edge)];
  return removeUnits(state, at, anchor, from, to);
};
