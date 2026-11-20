import {
  type Block,
  type Cell,
  containerContent,
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

/** The block's content as units, with the colour spans taken out and turned into each unit's style. */
const toUnits = (content: Inline): Unit[] => {
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
          const style: TextStyle = {};
          for (const [, kind, value] of ours[1].matchAll(ATTRIBUTE)) style[kind as StyleKind] = value;
          open.push(style);
          continue;
        }
        if (SPAN_CLOSE.test(piece) && open.length > 0) {
          if (open.pop() !== null) continue;
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
