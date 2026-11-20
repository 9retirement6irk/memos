import type { Editor, Extension } from "@usememos/editor";
import "./textColourPicker.css";
import { applyTextStyle, HIGHLIGHT_COLOURS, type StyleKind, TEXT_COLOURS, textStyleAt } from "./textColours";

export interface TextColourLabels {
  /** The toolbar button and its panel. */
  title: string;
  colour: string;
  highlight: string;
  noColour: string;
  noHighlight: string;
  /** Each colour's name, for the swatches. */
  names: Record<string, string>;
}

const SVG = "http://www.w3.org/2000/svg";
/** Lucide's palette (ISC), for the themes that show Lucide icons. */
const PALETTE_SHAPES: [string, Record<string, string>][] = [
  ["path", { d: "M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" }],
  ["circle", { cx: "13.5", cy: "6.5", r: ".5", fill: "currentColor" }],
  ["circle", { cx: "17.5", cy: "10.5", r: ".5", fill: "currentColor" }],
  ["circle", { cx: "6.5", cy: "12.5", r: ".5", fill: "currentColor" }],
  ["circle", { cx: "8.5", cy: "7.5", r: ".5", fill: "currentColor" }],
];

/** The editor's formatting toolbar element. The editor offers no way to add a control, so this reads its own field; a version without it just shows no colour button. */
const toolbarOf = (editor: Editor): HTMLElement | null => {
  const toolbar = (editor as unknown as { toolbar?: { popup?: { el?: unknown } } }).toolbar?.popup?.el;
  return toolbar instanceof HTMLElement ? toolbar : null;
};

/** Which side of the selection the toolbar opened on: the editor's own record of it, or where it sits. */
const toolbarSide = (editor: Editor, toolbar: HTMLElement, doc: Document): "above" | "below" => {
  const side = (editor as unknown as { toolbar?: { popup?: { side?: unknown } } }).toolbar?.popup?.side;
  if (side === "above" || side === "below") return side;
  const selection = doc.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
  return range && toolbar.getBoundingClientRect().top < range.top ? "above" : "below";
};

/** The button's icon, made like the toolbar's own: a Vista picture slot under Aero, else a Lucide-style SVG. */
const iconLike = (toolbar: HTMLElement): Element | null => {
  const model = toolbar.querySelector(".mbe-tool-bold .mbe-icon, .mbe-tool .mbe-icon");
  if (!model) return null;
  const icon = model.cloneNode(false) as Element;
  if (icon instanceof HTMLElement && icon.dataset.aeroIcon) {
    icon.dataset.aeroIcon = "textColour";
    return icon;
  }
  if (icon.namespaceURI === SVG) {
    for (const [name, attributes] of PALETTE_SHAPES) {
      const shape = icon.ownerDocument.createElementNS(SVG, name);
      for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, value);
      icon.appendChild(shape);
    }
    return icon;
  }
  return null;
};

/**
 * Text colour and highlight in the formatting toolbar: a button after the inline formats that opens a
 * small panel of swatches. Choosing one writes a `<span data-color>` or `<span data-highlight>` around the
 * selection (see textColours.ts) as one undo step. The panel, like the toolbar, keeps the editor's selection.
 */
export const textColourPicker = (labels: TextColourLabels): Extension => ({
  name: "text-colours",
  onCreate: ({ editor }) => {
    const toolbar = toolbarOf(editor);
    if (!toolbar) return;
    const doc = toolbar.ownerDocument;

    const button = doc.createElement("button");
    button.type = "button";
    button.className = "mbe-tool mbe-tool-menu memo-tool-colour";
    button.setAttribute("aria-label", labels.title);
    button.title = labels.title;
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    const icon = doc.createElement("span");
    icon.className = "mbe-tool-icon";
    const picture = iconLike(toolbar);
    if (picture) icon.appendChild(picture);
    const chevron = toolbar.querySelector(".mbe-tool-chevron")?.cloneNode(true);
    button.append(icon, ...(chevron ? [chevron] : []));
    // After the inline formats (link, else the last of them), before the block ones.
    const after =
      toolbar.querySelector(".mbe-tool-link") ??
      Array.from(toolbar.querySelectorAll(".mbe-tool-bold, .mbe-tool-italic, .mbe-tool-strike, .mbe-tool-code")).at(-1);
    if (after) after.after(button);
    else toolbar.appendChild(button);

    const panel = doc.createElement("div");
    panel.className = "mbe-ui memo-colour-panel";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", labels.title);
    // Like the toolbar: a press here must not take the selection away from the editor.
    panel.addEventListener("mousedown", (event) => event.preventDefault());

    const swatches: HTMLButtonElement[] = [];
    const row = (kind: StyleKind, title: string, none: string, values: readonly string[]) => {
      const group = doc.createElement("div");
      group.className = "memo-colour-row";
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", title);
      const heading = doc.createElement("span");
      heading.className = "memo-colour-title";
      heading.textContent = title;
      heading.setAttribute("aria-hidden", "true");
      group.appendChild(heading);
      for (const value of ["", ...values]) {
        const swatch = doc.createElement("button");
        swatch.type = "button";
        swatch.className = "memo-colour-swatch";
        swatch.dataset.kind = kind;
        swatch.dataset.value = value;
        const name = value ? (labels.names[value] ?? value) : none;
        swatch.setAttribute("aria-label", name);
        swatch.title = name;
        swatch.setAttribute("aria-pressed", "false");
        // The swatch is a sample drawn by text-colours.css, so it shows the shade the theme will use.
        const sample = doc.createElement("span");
        sample.className = "memo-colour-sample";
        sample.textContent = kind === "color" ? "A" : "ab";
        if (value) sample.dataset[kind] = value;
        swatch.appendChild(sample);
        swatch.addEventListener("click", () => {
          editor.run((state) => applyTextStyle(state, kind, value || null));
          close();
        });
        swatches.push(swatch);
        group.appendChild(swatch);
      }
      panel.appendChild(group);
    };
    row("color", labels.colour, labels.noColour, TEXT_COLOURS);
    row("highlight", labels.highlight, labels.noHighlight, HIGHLIGHT_COLOURS);

    const place = () => {
      // As the editor places its own toolbar menus (Text style, List): from the button, on the toolbar's
      // side away from the selection, flipped to the other side when it doesn't fit, kept in the viewport.
      const view = doc.defaultView;
      const viewport = view?.visualViewport
        ? {
            left: view.visualViewport.offsetLeft,
            top: view.visualViewport.offsetTop,
            width: view.visualViewport.width,
            height: view.visualViewport.height,
          }
        : {
            left: 0,
            top: 0,
            width: view?.innerWidth ?? doc.documentElement.clientWidth,
            height: view?.innerHeight ?? doc.documentElement.clientHeight,
          };
      const anchor = button.getBoundingClientRect();
      const gap = 4;
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const below = viewport.top + viewport.height - 8 - (anchor.bottom + gap);
      const above = anchor.top - gap - 8 - viewport.top;
      let side = toolbarSide(editor, toolbar, doc);
      if (side === "below" && height > below && above > below) side = "above";
      else if (side === "above" && height > above && below > above) side = "below";
      const top = side === "below" ? anchor.bottom + gap : anchor.top - height - gap;
      const left = Math.max(viewport.left + 8, Math.min(anchor.left, viewport.left + viewport.width - width - 8));
      // Fixed position is relative to the panel's containing block, which a transformed dialog can move.
      panel.style.left = "0px";
      panel.style.top = "0px";
      const origin = panel.getBoundingClientRect();
      panel.style.left = `${Math.round(left - origin.left)}px`;
      panel.style.top = `${Math.round(top - origin.top)}px`;
    };

    const onOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !panel.contains(target) && !button.contains(target)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !panel.hidden) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    const open = () => {
      // The toolbar's colours come from the editor's theme variables, set on it; the panel takes the same.
      for (const property of Array.from(toolbar.style)) {
        if (property.startsWith("--")) panel.style.setProperty(property, toolbar.style.getPropertyValue(property));
      }
      (toolbar.parentElement ?? doc.body).appendChild(panel);
      const style = textStyleAt(editor.state);
      for (const swatch of swatches) {
        const kind = swatch.dataset.kind as StyleKind;
        swatch.setAttribute("aria-pressed", String((style[kind] ?? "") === swatch.dataset.value));
      }
      panel.hidden = false;
      place();
      button.classList.add("mbe-open");
      button.setAttribute("aria-expanded", "true");
      doc.addEventListener("pointerdown", onOutside, true);
      doc.addEventListener("keydown", onKey, true);
    };
    function close() {
      if (panel.hidden) return;
      panel.hidden = true;
      button.classList.remove("mbe-open");
      button.setAttribute("aria-expanded", "false");
      doc.removeEventListener("pointerdown", onOutside, true);
      doc.removeEventListener("keydown", onKey, true);
    }
    button.addEventListener("click", () => (panel.hidden ? open() : close()));

    // The panel goes when the toolbar does (the selection collapsed, the editor lost focus).
    const watch = new MutationObserver(() => {
      if (toolbar.hidden) close();
    });
    watch.observe(toolbar, { attributes: true, attributeFilter: ["hidden"] });

    return () => {
      close();
      watch.disconnect();
      button.remove();
      panel.remove();
    };
  },
});
