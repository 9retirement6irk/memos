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
- `realistic.ts` is the Realistic brushes and `brushes.ts` the Wacky ones. `audio.ts` plays clips
  from one audio sprite.
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

- A tube button has three scripts in `Easel.MHK`, and `TUBE_TOOLS` follows them, checked against
  the original running. Pointed at with a mouse, a button that is not the tool in hand loops its
  hover script: its frames in the script's order, and the tool's own clip on every pass. Chosen, it
  flashes its lit frame for one step with the chosen clip (1002, or 1000 for the libraries), and the
  button it replaces plays its rest clip (1001). The yellow ring on the tool in hand is ours.
- Each paint tool's start, loop, stop and effect clips come from its `[<ToolName>Snd]` section in
  `KP.cfg`. `KIDPIX_TOOL_NAMES` is the tool list from `KP.exe`; tray icon 3500 + n is tool n.
  `KIDPIX_TOOL_MOTION` holds how a tool's sound follows the pointer, measured on the original: where
  the section says `continuous = off` (the Pencil's kinds, most Realistic brushes) the loop sounds
  only while the pointer moves, and a tool's direction clips play as a stroke sets off or reverses
  up, down, left or right. The cfg's north is down the screen.
- A shape's sound runs from its first press to its last: through a curve's bending, and from a
  polygon's first corner to its closing one, where its stop clip plays.
- Undo Guy's 20 lines, the dynamite's fuse and boom, the stamp clip (7320) and the color click
  (31504) are the ones the program plays.
- The Firecracker (the dynamite on the tube) follows its button scripts and its eraser: pointed at,
  its fuse sparks (clip 1028); clicked, it lights (1027), and a second and a half later rings spread
  from the foot of the paper with the eraser's clip (7219) until the paint is gone. In Kid Pix the
  rings also travel outward, so the whole picture flickers to its negative nine times a second; here
  each ring stays where it lands, and with reduced motion the paint simply goes.

Stand-ins, written for this mode:

- Fourteen of the sixteen Big Eraser effects. The disc holds their icons, names and sounds, not
  their code, and under Wine the original clears the page at once without showing them, so they
  could not be recorded. Firecracker and Explode did show, and are the rings.
- The tray's option click, and the startup jingle on entering the mode.

## Brushes and mixers, matched to the original

The disc has no code for what a brush draws, so each was drawn with in the original (one tap and
one stroke on a clean page) and rebuilt here from the result.

- **Realistic brushes (tools 0 to 19):** `realistic.ts` presses a tip bitmap along the stroke.
  The 60 tips (20 brushes at three sizes) are `Brushes.MHK`'s, packed into
  `assets/brush-tips.png`; `tips.ts` (generated) pairs each brush with its `KP.cfg` settings. What
  the settings do was fitted to the original's pixels:
  - `spacing`: px between presses. Where the cfg gives none it was fitted (in `tips.ts`).
  - `oscillation`: a press lands up to 1.6 times this far from the stroke.
  - `shadowOffset`, `shadowBias`: a black copy of the tip that far down and right, at 1/bias strength.
  - `densityBias`: the tip marks at 1/density strength.
  - `spatter`: pixels are dropped at random instead (one kept in spatter x density).
  - The tray's three sizes choose among a brush's three tips.
  - Not modeled: `glintOffset`, `dryOutRate` and `smearBias`, which did not show in a short stroke.
- **Wacky brushes (tools 20 to 44):** all twenty-five follow the original.
  - Madona (a pyramid from the press to the pointer), Spiral (a banded disc out to the pointer) and
    Poly (a filled shape that gains a corner every 0.9 s) are redrawn as the pointer moves, like
    the box brushes. Tri Spin and Whispy Circle stamp a 30 px black tile.
  - Window, Door, Door Plain, Roof, Rainbow and Color Tile are dragged out as a box, like the Draw
    tool's rectangle. The Window is `Icons.MHK`'s own frame (`assets/brush-window.png`) stretched
    to the box; doors and the roof are built from its panes, panels, knob and shingle tile
    (`assets/brush-parts.png`).
  - Bricks and Log lay the disc's 32 x 16 tiles in courses.
  - The ABC brush writes "Kid Pix", a letter at a time, until Edit ABC Text is built.
- **Mega-mixers (tools 65 to 86):** each was run on one test picture in the original, and
  `raster.ts` was checked against the same picture. The ten color effects match to the value;
  Kid Pix measures brightness by a pixel's strongest channel, so pure green is as bright as
  white. The bending effects (Pinch to Shear) match by eye; Kaleidoscope and Pointilize are close
  but not the original's.

- **Mixer wands (tools 87 to 98):** a wand's effect lands once on whatever it passes over in a
  stroke, however often it passes, in a round tip 10, 15 or 23 px across (the size control). So
  the engine mixes the whole picture when the wand goes down and the stroke uncovers it. Smear
  drags what is under it along instead. The Blur wand plays the plain brush's clips.
- **Little Eraser:** a round or square tip at 2, 10 or 20 px, with the pencil's sounds. In Kid
  Pix it leaves white; here it takes the paint away, so the drawing under it shows.

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
    Here it does the same, over the paint, with the animation's own clip (`<set>.m4a`): every
    other step of the disc's scripts is shipped, each shown for two steps' time (about a fifth of a
    second), and with reduced motion the drop lands at once. Starting another stroke, Undo Guy or
    leaving the mode brings drops still moving to rest first.
  - The Wacky brushes do not move once the button is let go: each of the 25 was drawn on the
    original and watched for five seconds, and none changed.
  - The set names are ours; the disc has none.

## The tray, laid out as Kid Pix lays it out

Checked against the original running under Wine.

- One row of options at Kid Pix's 48 px, as many as the sheet's width fits, a page at a time; the
  arrows turn the page, round from the last to the first, and the counter between them shows which. A phone keeps its scrolling strip.
- The size control (`assets/sizes.png`): three balls for the Pencil's kinds and the paint brush.
  `PENCIL_WIDTHS` are the widths the original draws, measured per kind, and `PENCIL_NIBS` what one
  press of each lays down: the pencil a hard-edged disc, chalk and crayon a scatter of single-pixel
  grains that build up, the marker a thin slanted tip that stays see-through. The brush's size picks
  among a Realistic brush's three tips; the Wacky ones have none.
- Two mode buttons (`assets/modes.png`): Realistic and Wacky for the brush (brushes 0 to 19, and
  the rest), 3D Shapes and Moving Paint for the can. Each mode keeps its own choice.
- The text tray: font (all 22 of the disc's), size, bold, italic, underline and alignment
  (`assets/textui.png`), and Read Aloud (`assets/read.png`) with the browser's voices, where it
  has speech. Text is typed in a box that grows with it; Enter starts a new line, and a press on
  the paper or a change of tool leaves the box loose on the picture, to be opened again, until it
  is flattened (see "Shapes, buckets and stickers").

## The tray's tool kinds

The Pencil's four kinds, the brush zone's paint brush and Spray Can, and the three Fill Buckets
lie in the tray's molded panel and move as Kid Pix moves them (`KindPanel.tsx`): a kind wiggles
when pointed at, is picked up when chosen, and the one before it is then laid back in its mold.
Each is a button script on the disc (`TP.MHK` 18060 to 18089) with its own clip. `kinds.ts`
(generated) holds the scripts; `assets/kinds-*.png` hold every frame they show and the mask of
where the color in hand shows through. A frame's place comes from the script's position, less
the frame's registration point (`REGS`, indexed one past the frame). The brush panel's middle
mold is Sound Art's microphone, which is not built.

The Moving Van's tray has Kid Pix's Grab pair in the same panel (scripts 18128 to 18133): the hand,
which moves all the paint as before, and the scissors.

The Electric Mixer and the Eraser have their pairs too (scripts 18090 to 18095 and 18134 to 18139):
Mega-Mixer and Mini-Mixer, Little Eraser and Big Eraser. Each tool's options are still one list;
a kind shows its part of it and remembers its own choice.

## The scissors

Kid Pix's cut tool (`CutTool.tsx`, `cut.ts`), built from the original running side by side:

- The tray holds fourteen shapes, with the disc's icons (`CutRgns.MHK`, `assets/cut-options.png`).
  Four are drawn: free-form (let go, it closes with a straight line to where it began), polygon (a
  press a corner, closed on the first), oval and rectangle. Ten are cookie cutters, which follow
  the pointer and cut their own shape, at its own size, with one click. A cutter is a region on
  the disc (`MRGN`: a list of rectangles); `assets/cut-shapes.png` holds the ten as masks and
  `cutters.ts` (generated) where each is.
- What is marked shows in fine slanted lines, as in Kid Pix, not a moving border. Dragged, the
  paint in it comes off the paper and follows the pointer, floating over the picture; a press
  anywhere else, another shape or a change of tool sticks it down.
- The three buttons are the tray's own (`assets/cut-buttons.png`): the Trash Can throws away
  what is marked or in hand, Duplicate remembers it, and Paste drops a copy in the middle of the
  paper, ready to move, as often as it is clicked.
- Undo Guy puts a piece in hand back where it was cut from. Once stuck down, a move is one step.
- The drawing sounds are the tools' own from `KP.cfg` (111 to 114); a shape marked plays 7428, a
  piece picked up 7429 and let go 7430.

Unlike Kid Pix, a piece carries only paint: the original's picture is one opaque sheet, so its
pieces take the white around the paint with them and leave a white hole. Here the paper, a
background and the drawing under the paint stay where they are, as with the Little Eraser. A piece
also cannot be resized, and text and stickers already pressed in are paint like the rest.

## Cursors, colors, textures, stamps, help and ideas

- **Cursors.** The pointer over the paper is the disc's cursor for the tool or kind in hand
  (`General.MHK`, 29 of them, 16 px, shown at 32; `cursors.ts`, generated). Which cursor goes with
  which tool was read off the pictures, not the program (`PENCIL_CURSORS`, `TOOL_CURSORS`). The Text
  tool keeps the browser's text cursor.
- **Color picker.** The wheel opens Kid Pix's own panel (`BigPicker.MHK`, `assets/picker.png`) with
  its clips. The grid's colors are read off its picture (`picker.ts`, generated): grays down the
  left, skin tones down the right. The Eye Dropper takes the color showing at the next press on
  the paper, whether paint, background, drawing or paper.
- **Paper Texture.** A button beside the picker offers plain paper or one of the disc's twenty
  textures (`TextureMaps.MHK`, 600 x 452 gray pictures, fetched from `web/public/kidpix/textures`
  when chosen). The Chalk, the Crayon and the Marker show it: once a stroke or shape is finished,
  what it laid is kept where the texture is light and thinned where it is dark (`grainPixels`).
  The original shows the texture while the stroke is being drawn; here it appears on letting go.
- **Stamp sizes and the Stamp Editor.** Stamps take the size control: 32, 64 or 128 px, the
  bitmap once, twice and four times over, as measured on the original. Edit Stamp opens Kid Pix's
  Stamp Editor on the stamp in hand (`StampEditor.tsx`; window, buttons, grid and clips from
  `StampEd.MHK`, laid out by `stampEditor.ts`, generated): Pencil, Fill Bucket, Undo (one step, and
  back again), Firecracker, Flip, Rotate, Restore Original, Cancel, OK. An edited stamp is used for
  as long as the mode stays open; the tray still shows the original.
- **Help.** With the tube's question mark in hand, the next click asks about what was clicked
  instead of using it: a window shows Kid Pix's words for it and plays the disc's narration
  (`help.ts`, generated from `KP.cfg`, `kplang_en.ini` and `RHelpDlg.MHK`; 83 lines, a file each
  under `web/public/kidpix/help`, fetched when asked for). Controls name their line with a
  `data-help` attribute. The words are the disc's, in English, like the narration. The window is
  this mode's own, not the disc's.
- **Idea Machine.** The tube's other cap button opens the disc's 572 picture starters in their 52
  folders under nine topics (`ideas.ts`, generated; pictures and thumbnail strips under
  `web/public/kidpix/ideas`, fetched a folder at a time). A `.kpx` file is a Mohawk archive holding
  the picture as a JPEG. A starter becomes the background, like one of Kid Pix's own.

## Shapes, buckets and stickers

- The Pencil's tray holds its sizes, then nine shapes (`PENCIL_SHAPES`, Kid Pix's modifier tools
  103 to 110, with their sounds). A line, rectangle or oval is dragged out. A curve is dragged as
  a line; let go, it bends toward the pointer, and a press sets it (on a touch screen, a second drag). A polygon takes a press for each corner and closes on a
  press at its first, which wears a ring. Changing tool, or Undo Guy, drops a shape left half-made.
- The Fill Buckets are three kinds, as in Kid Pix. Solid lays the color in hand through one of 42
  one-color patterns (`assets/solid-tiles.png`; the first is plain). The pattern is how much color
  lands on each pixel, so a second color can go over a first. Blend and Pattern bring their own colors.
  A Blend follows the pointer for as long as the button is held, running off one edge of its area
  and back in at the other; how far the original slides it was not measured.
- The ABC brush writes the tray's Edit ABC Text, a letter a step.
- The letter stamps are 56: the alphabet, the digits and fifteen marks, each saying its name when
  chosen (the names past Z are matched to the stamps by their order on the disc, not by ear), then
  CH, LL, Ñ, ¿ and ¡ from the disc's Spanish alphabet, which have no English name.
- A sticker goes down in a frame: drag inside to move it, a round corner to resize it, the square
  corners to flip it left to right or top to bottom; the arrow keys nudge it, Delete removes it.
  As in Kid Pix, every sticker stays loose over the paint until it is flattened: a press on the
  paper or a change of tool only lets it out of its frame, and the hand or the Stickers tool picks
  any of them up again. Flatten Stickers in the tray, Enter on the one in the frame, or leaving the
  mode makes them paint. Import Sticker brings in a picture of one's own at its own size.
- A text box left is loose in the same way, and the Text tool opens it again to be typed on, in
  the font, size, style and color it had; the hand moves it, and in its frame it can be sized,
  flipped or deleted. Sizing stretches the letters; Kid Pix re-wraps them instead. The box checks
  spelling as the browser does.

- Pictures: the sheet's Insert image button stays in the mode's top bar (from this device, or from
  Immich when it is connected), and a pasted picture counts too. This is Kid Pix's Add Graphic, and
  asks its four fits: stretched to the paper, grown or shrunk to cover it, centered at its own size,
  or repeated to fill it. The picture then lies loose in the sticker's frame. Import Background is
  not built: set the picture down and paint over it.
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
