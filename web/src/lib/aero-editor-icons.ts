import type { IconName, Icons } from "@usememos/editor";

/**
 * The editor controls that show a Vista picture under an Aero theme: the formatting
 * toolbar, its block and list menus, and the same items in the slash menu. Headings
 * keep their H1–H4 glyphs, which say more than any picture could.
 */
export const AERO_EDITOR_ICONS = [
  "text",
  "bold",
  "italic",
  "strike",
  "inlineCode",
  "link",
  "bulletList",
  "numberedList",
  "todoList",
  "quote",
  "code",
] as const satisfies readonly IconName[];

/**
 * Icons for the editor under an Aero theme. Each is an empty `.mbe-icon` naming its control
 * in `data-aero-icon`; aero.css draws the picture, so the pictures live with the theme's
 * other icons. The editor reads icons once, so its host recreates it when the theme
 * switches between Aero and the rest.
 */
export const aeroEditorIcons = (doc: Document = document): Icons =>
  Object.fromEntries(
    AERO_EDITOR_ICONS.map((name) => {
      const icon = doc.createElement("span");
      icon.className = "mbe-icon";
      icon.dataset.aeroIcon = name;
      icon.setAttribute("aria-hidden", "true");
      return [name, icon];
    }),
  );
