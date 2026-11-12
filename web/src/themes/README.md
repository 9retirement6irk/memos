# Themes

Color, shadow and font tokens come from `@usememos/ui` (read `web/node_modules/@usememos/ui/llms.txt`,
then its color.md). Every token is a CSS variable named `--mu-<name>`; the Tailwind utilities for them
carry an `mu-` prefix (`bg-mu-surface`, `text-mu-ink-muted`).

- **Light and Dark** are the package's own themes, selected by `data-theme="light" | "dark"` on `<html>`.
  `utils/theme.ts` sets the attribute from the saved preference (`default`, `default-dark`, `paper` or
  `system`, kept as they are in the account setting and in localStorage) and the OS scheme.
- **Paper** (`paper.css`) is memos' app theme: a `[data-theme="paper"]` rule that must set every name in
  the package's `themeTokens` (27 colors and 5 shadows), with every text pair at 4.5:1 or more.
  `tests/paper-theme.test.ts` checks both. Its primary stays ink, warm rather than a brand hue.
- `default.css` only sets the text fonts to the package's and adds the wordmark's serif. Colors, radius
  and shadows are used through the package's `mu-` utilities and `var(--mu-*)`; memos keeps no names of
  its own for them. The admin "Additional style" setting must target the same tokens and `mu-` classes.

There is no `.dark` or `.light` class; `color-scheme` comes from the theme rule, and the memo editor
follows it.

## Aero (this build)

The Aero family is a Windows Vista look: **Aero Light**, **Aero Dark** and **Aero Paper**, plus **Aero (sync
with system)**, saved as `aero`, `aero-dark`, `aero-paper` and `aero-system` and shown as
`data-theme="aero-light" | "aero-dark" | "aero-paper"`.

- `aero-light.css`, `aero-dark.css` and `aero-paper.css` are app themes like Paper: one rule each that sets
  every token. `tests/app-themes.test.ts` checks all four app themes for every token and for 4.5:1 text contrast.
- `aero/aero.css` draws the rest under `[data-theme^="aero-"]`: the Aurora wallpaper, glass sidebar,
  the window frame, glossy keys, sticky-note memos, the calendar pad and the Vista icons in `aero/`.
  It targets memos' styling hooks rather than Tailwind classes: `data-app-sidebar`, `data-app-window`
  (`components/AppWindow.tsx`), `data-memo-card`, `data-pinned-mark`, `data-memo-editor`,
  `data-column-grid`, `data-current` on sidebar rows, and `data-outside-month` / `data-today` /
  `data-level` on calendar days. Add a hook to a component before matching its classes.
- `components/AppWindow.tsx` frames the page in an Aero window only while an Aero theme is on: the
  caption shows the instance title, the red close button signs out, and with the multi-column memo
  grid the window narrows to the packed columns. `hooks/useAeroAppIcons.ts` swaps in the Aero app
  icons and an install manifest named after the instance.
- The Vista icons in `aero/` are Microsoft's; keep this repository and its images private.

