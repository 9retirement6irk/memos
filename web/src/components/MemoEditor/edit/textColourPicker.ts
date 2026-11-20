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
      // Beside the toolbar, on the side away from the selected text, as the editor's own menus open.
      const box = toolbar.getBoundingClientRect();
      const range = doc.getSelection()?.rangeCount ? doc.getSelection()?.getRangeAt(0).getBoundingClientRect() : null;
      const above = range ? box.top < range.top : false;
      const anchor = button.getBoundingClientRect();
      const width = panel.offsetWidth;
      const left = Math.max(8, Math.min(anchor.left, doc.documentElement.clientWidth - width - 8));
      panel.style.left = `${Math.round(left)}px`;
      panel.style.top = above ? `${Math.round(box.top - panel.offsetHeight - 4)}px` : `${Math.round(box.bottom + 4)}px`;
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
