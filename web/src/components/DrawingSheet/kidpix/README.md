# Kid Pix mode

A second set of tools for the drawing sheet, in the chrome of Kid Pix Deluxe 4: the tool tube,
the options tray, the color wheel, Undo Guy and the sounds. The sheet's Kid Pix button turns it
on; "Back to drawing tools" turns it off.

The layout follows Kid Pix's own screen: tools two to a row in the tube in its order, the
dynamite and Undo Guy on the tube's lower cap, the color wheel in the corner, and a tray whose
first panel holds the tool's kinds (the Pencil's pencil, chalk, crayon and marker) or its
library category, with the options and their paging arrows beside it. The two round buttons at
the tray's end (play and slide show) and the two on the tube's top cap (ideas and help) are
part of the art and do nothing here.

## How it fits the drawing sheet

`@usememos/canvas` keeps a drawing as shapes. Kid Pix tools paint pixels, so the mode paints on
its own bitmap, laid over the drawing:

- `KidPixLayer.tsx` is the chrome and the pointer handling. It loads on first use, with its art.
- `engine.ts` is the paint layer: one layer pixel per drawing px, 12 undo steps.
- `raster.ts` is the pixel work (flood fill, mixers, tiles), on plain arrays so it tests without a canvas.
- `brushes.ts` is the Wacky Brush strokes. `audio.ts` plays clips from one audio sprite.
- `swf.ts` reads and draws stickers, which are small Flash movies. `library.ts` lists the stamp,
  sticker and background libraries, whose files are in `web/public/kidpix/`.

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
and gradients, the stamps, stickers, backgrounds, eight fonts, and every sound.

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

## The libraries

Stamps, stickers and backgrounds come from the disc's `Libraries/*.klb` files, which are Mohawk
archives like the rest. Each tool has a category list in the tray; a category's file is fetched
when it is first shown.

- Stamps: 2,240 rubber stamps at 32 px, one PNG strip per category, stamped at 64 px with hard
  pixels. White joined to a stamp's edge is made transparent.
- Stickers: 935 pictures, kept as the disc's own Flash movies and drawn by `swf.ts`, so a
  category of 20 is about 100 kB. Four that use text or bitmaps are left out.
- Backgrounds: 180 pictures at 600 x 452, re-encoded from 70 MB to 7 MB. A background sits
  behind the paint with the drawing copied over it, and becomes part of the picture the mode
  adds to the drawing.

Not built: animations and recorded sounds (a saved drawing is a still PNG and cannot hold
either) and the voice brushes.

Tool, brush and font names are Kid Pix's own product names and are not translated.

## Where the files come from

Everything in `assets/`, `web/public/kidpix/`, `data.ts` and `library.ts` was extracted from a Kid Pix Deluxe 4 disc: bitmaps and
sounds from its Mohawk (`.MHK` and `.klb`) archives, the tables from `KP.cfg` and `KP.exe`. `data.ts`
and `library.ts` are generated; regenerate them rather than editing them.

Kid Pix and its art, fonts and sounds belong to their owners. They are in this repository for a
private instance; clear the rights before publishing a build that includes this folder.
