# Kid Pix mode

A second set of tools for the drawing sheet, in the chrome of Kid Pix Deluxe 4: the tool tube,
the options tray, the color wheel, Undo Guy and the sounds. The sheet's Kid Pix button turns it
on; "Back to drawing tools" turns it off.

## How it fits the drawing sheet

`@usememos/canvas` keeps a drawing as shapes. Kid Pix tools paint pixels, so the mode paints on
its own bitmap, laid over the drawing:

- `KidPixLayer.tsx` is the chrome and the pointer handling. It loads on first use, with its art.
- `engine.ts` is the paint layer: one layer pixel per drawing px, 12 undo steps.
- `raster.ts` is the pixel work (flood fill, mixers, tiles), on plain arrays so it tests without a canvas.
- `brushes.ts` is the Wacky Brush strokes. `audio.ts` plays clips from one audio sprite.

When the mode ends, or on Done, `DrawingSheet` lifts the paint off as PNG tiles and adds them to
the drawing with `insertImage`, where they were painted, grouped as one picture. The canvas
shrinks a picture over 1440 px a side or over 80% of the view, which is why the paint goes in
as tiles under both limits. Zoomed out, the sheet zooms to 1 first, so the layer is never larger
than the screen.

The Paint Can and the mixers read the drawing under the paint (from the canvas's own
`<canvas>` elements), so a can fills a shape drawn with the memos tools. The eraser, the screen
erasers and the dynamite remove Kid Pix paint only.

## What is Kid Pix's and what is not

From the disc, unchanged: the tube, tray, wheel and button art, the option icons, the patterns
and gradients, the letter stamps, eight fonts, and every sound.

The sounds are wired as Kid Pix wires them:

- A tube button's hover and select clips come from its button scripts in `Easel.MHK`.
- Each paint tool's start, loop, stop and effect clips come from its `[<ToolName>Snd]` section in
  `KP.cfg`. `KIDPIX_TOOL_NAMES` is the tool list from `KP.exe`; tray icon 3500 + n is tool n.
- Undo Guy's 20 lines, the dynamite's fuse and boom, the stamp clip (7320) and the color click
  (31504) are the ones the program plays.

Stand-ins, written for this mode:

- What each Wacky Brush and mixer draws. The disc holds their icons, names and sounds, not their code.
- The tray's option click, and the startup jingle on entering the mode.
- Undo Guy's mouth moves at random while a line plays; the disc's scripts time each line exactly.

Not built: stickers, animations, backgrounds and recorded sounds (their libraries are in `.klb`
files not yet decoded) and the voice brushes.

Tool, brush and font names are Kid Pix's own product names and are not translated.

## Where the files come from

Everything in `assets/` and `data.ts` was extracted from a Kid Pix Deluxe 4 disc: bitmaps and
sounds from its Mohawk (`.MHK`) archives, the tables from `KP.cfg` and `KP.exe`. `data.ts` is
generated; regenerate it rather than editing it.

Kid Pix and its art, fonts and sounds belong to their owners. They are in this repository for a
private instance; clear the rights before publishing a build that includes this folder.
