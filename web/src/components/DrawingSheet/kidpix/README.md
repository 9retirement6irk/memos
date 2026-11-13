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
and gradients, the stamps, stickers, backgrounds, 22 fonts, and every sound.

The sounds are wired as Kid Pix wires them:

- A tube button's hover and select clips come from its button scripts in `Easel.MHK`.
- Each paint tool's start, loop, stop and effect clips come from its `[<ToolName>Snd]` section in
  `KP.cfg`. `KIDPIX_TOOL_NAMES` is the tool list from `KP.exe`; tray icon 3500 + n is tool n.
- Undo Guy's 20 lines, the dynamite's fuse and boom, the stamp clip (7320) and the color click
  (31504) are the ones the program plays.

Stand-ins, written for this mode:

- What each Wacky Brush and mixer draws. The disc holds their icons, names and sounds, not their code.
- The tray's option click, and the startup jingle on entering the mode.

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

- Spray Can: the brush zone's second kind, with the disc's 35 picture sets, in
  `web/public/kidpix/spray/` (4.5 MB, a set fetched when it is first chosen). `spray.ts` lists them
  and is generated. It behaves as the original does, measured by running Kid Pix itself:
  - A picture drops on the pointer the moment the can goes down and every 108 ms after, moving or not.
  - 3D shapes (`Cyclic.MHK`, 15 sets, up to 40 pictures each) land centered and hiss with clip 7200
    for as long as the can is held; a single tap is silent.
  - Moving paint (`Anims.MHK`, 20 sets) plays an animation for each drop and leaves its last frame.
    Here only that last frame is drawn, where the animation would have carried it, with the
    animation's own clip (`<set>.m4a`). The animations themselves are not played.
  - The set names are ours; the disc has none.

## The tray, laid out as Kid Pix lays it out

Checked against the original running under Wine.

- One row of options at Kid Pix's 48 px, as many as the sheet's width fits, a page at a time; the
  arrows turn the page and the counter between them shows which. A phone keeps its scrolling strip.
- The size control (`assets/sizes.png`): three balls for the Pencil's kinds and the paint brush.
  `PENCIL_WIDTHS` are the widths the original draws, measured per kind. The brush's size scales
  the Realistic brushes; the Wacky ones have none, as in Kid Pix.
- Two mode buttons (`assets/modes.png`): Realistic and Wacky for the brush (brushes 0 to 19, and
  the rest), 3D Shapes and Moving Paint for the can. Each mode keeps its own choice.
- The text tray: font (all 22 of the disc's), size, bold, italic, underline and alignment
  (`assets/textui.png`), and Read Aloud (`assets/read.png`) with the browser's voices, where it
  has speech. Text is typed in a box that grows with it; Enter starts a new line, and a press on
  the paper or a change of tool presses it into the paint. Kid Pix keeps text boxes editable until
  Flatten; here a box is flattened when it is left.

## The tray's tool kinds

The Pencil's four kinds, the brush zone's paint brush and Spray Can, and the three Fill Buckets
lie in the tray's molded panel and move as Kid Pix moves them (`KindPanel.tsx`): a kind wiggles
when pointed at, is picked up when chosen, and the one before it is then laid back in its mold.
Each is a button script on the disc (`TP.MHK` 18060 to 18089) with its own clip. `kinds.ts`
(generated) holds the scripts; `assets/kinds-*.png` hold every frame they show and the mask of
where the color in hand shows through. A frame's place comes from the script's position, less
the frame's registration point (`REGS`, indexed one past the frame). The brush panel's middle
mold is Sound Art's microphone, which is not built.

## Shapes, buckets and stickers

- The Pencil's tray holds its sizes, then nine shapes (`PENCIL_SHAPES`, Kid Pix's modifier tools
  103 to 110, with their sounds). A line, rectangle or oval is dragged out. A curve is dragged as
  a line, then bent with a second drag. A polygon takes a press for each corner and closes on a
  press at its first, which wears a ring. Changing tool, or Undo Guy, drops a shape left half-made.
- The Fill Buckets are three kinds, as in Kid Pix. Solid lays the color in hand through one of 42
  one-color patterns (`assets/solid-tiles.png`; the first is plain). The pattern is how much color
  lands on each pixel, so a second color can go over a first. Blend and Pattern bring their own colors.
- A sticker goes down in a frame: drag inside to move it, a round corner to resize it, the square
  corners to flip it left to right or top to bottom; the arrow keys nudge it, Delete removes it.
  It becomes paint on the next press on the paper, a change of tool, or when the mode ends. Kid Pix
  keeps every sticker loose until Flatten; here only the last one is.

- Pictures: the sheet's Insert image button stays in the mode's top bar (from this device, or from
  Immich when it is connected), and a pasted picture counts too. A picture lands in the sticker's
  frame, at most 70% of the paper, and becomes paint the same way; this is Kid Pix's Add Graphic.
  The sheet hands the files to the layer's `addPictures`.

Not built: animations and recorded sounds (a saved drawing is a still PNG and cannot hold
either) and the voice brushes.

The 16-bit sprites are run-length coded with gaps: each row starts with a count of pixels to skip,
and each run is followed by another. Skipped pixels are transparent. Magenta in a tray tool
(the pencils) marks where the color in hand shows through, shaded by a matching 8-bit frame; the
first twenty Wacky Brush icons are 8-bit shapes drawn in that color too.

Tool, brush and font names are Kid Pix's own product names and are not translated.

## Where the files come from

Everything in `assets/`, `web/public/kidpix/`, `data.ts` and `library.ts` was extracted from a Kid Pix Deluxe 4 disc: bitmaps and
sounds from its Mohawk (`.MHK` and `.klb`) archives, the tables from `KP.cfg` and `KP.exe`. `data.ts`
and `library.ts` are generated; regenerate them rather than editing them.

Kid Pix and its art, fonts and sounds belong to their owners and are not MIT; the credits are
under "Third-party assets" in the repository's README. Credit any new file there too.
