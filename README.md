# Memos

A personal fork of [Memos](https://github.com/usememos/memos), the self-hosted note-taking app. It
adds Windows Vista's Aero look, a journaling mode, connections to Immich, Dawarich and Home
Assistant, multi-page drawings with Kid Pix mode, and inline PDFs. It stays close to upstream:
upstream changes come in every day, and the database is left exactly as stock Memos expects, so
you can go back to stock Memos at any time.

- [What this fork adds](#what-this-fork-adds)
- [Your data stays stock Memos](#your-data-stays-stock-memos)
- [Install](#install)
- [What it connects to](#what-it-connects-to)
- [License](#license)

## What this fork adds

### Aero themes

Four extra themes in **Settings → Preferences → Theme**: **Aero · Light**, **Aero · Dark**,
**Aero · Paper**, and **Aero · Sync with system**, which follows your device's light or dark mode.

- **Windows:** a glass sidebar with a spiral binding, and each page in a Vista window. The red
  close button signs out, and with two or more memo columns the window narrows to fit them.
- **Memos:** sticky notes in seven colours, with tape, a curled corner and a gold star when
  pinned. Tags are glossy pills.
- **Controls:** Vista buttons, fields, menus, checkboxes, switches, dialogs, toast balloons and an
  orange calendar pad.
- **Icons:** Vista icons in place of the usual ones, on the editor's formatting toolbar too.
  Profile pictures are square, in the Vista user frame.
- **App icon:** while an Aero theme is on, the browser tab, home-screen icon and installed app use
  a Windows Journal notebook named after your instance.

### Journaling mode

Choose a journal Space in **Settings → Journal**. New memos there open as journal entries, and
the ＋ menu has a **Journaling mode** switch for writing an entry anywhere else.

- **Entries:** each one has a dated heading, a rotating prompt, your text, a checklist of daily
  goals, the activities you did, and an optional place and weather line.
- **Moods:** modelled on Apple's State of Mind.
  - Rate the whole day or right now, on a seven-step scale from very unpleasant to very pleasant.
  - Optionally add feeling words (Apple's 38) and what had the biggest impact (Apple's 18
    causes).
  - **Log how I feel** in the ＋ menu adds a quick check-in to any memo.
- **Place and weather:** the place can be where you are now, where Dawarich says you were, or a
  search. The weather comes from Open-Meteo for that place and hour, past dates included.
- **Suggestions from your photos:** recent Immich photos are grouped into outings. **Write about
  this** starts an entry dated when they were taken, at the place you visited, with the photos
  and, optionally, a route map attached.
- **Journal panel:** beside the journal Space you get:
  - your streak and On This Day from the past five years
  - a mood calendar for the month and a mood trend over eight weeks
  - the activities and causes linked with your best and hardest days
- **Its own view:** the journal Space can keep its own layout, such as a newest-first list,
  without changing Home's.
- **Streak reminders:** reminders through Home Assistant at the times and on the days you choose.
  They can be sent only on days you haven't written, and warn you when a streak is at risk.

Entries are ordinary Markdown memos with tags such as `#mood/pleasant`, `#felt/grateful` and
`#did/family`, so they read and search the same in stock Memos.

### Immich

Connect your own [Immich](https://immich.app) server in **Settings → Immich**. Each user connects
separately. Then:

- **Photos from Immich** in the editor's ＋ menu adds full-size copies to a memo. They keep
  working if Immich is offline or the photo is deleted there.
- The drawing sheet can insert Immich photos.
- The journal uses them for its suggestions.

Your API key stays on the Memos server and is never sent back to the browser.

### Dawarich

Connect [Dawarich](https://dawarich.app) in **Settings → Dawarich**, again per user.

- **Route from Dawarich** in the ＋ menu attaches a map of a day's travel, or of one journey. It
  shows the times and distance, over OpenStreetMap tiles that you can turn off.
- The journal uses your visits to name places.

### Drawings

- **Pages:** a memo's drawings work as pages of one drawing, with tabs in the drawing sheet and the
  viewer. **Add page** puts a new page after the current one.
- **Notebook paper:** draw on college-ruled, wide-ruled, Gregg-ruled, graph or dot-grid paper.
- **Kid Pix mode:** a second set of tools in the style of Kid Pix Deluxe 4, with its art, fonts and
  sounds:
  - tools: the Wacky Brush, Spray Can, Electric Mixer and dynamite
  - the Pencil's shapes: straight line, curve, rectangle, oval and polygon, empty or filled
  - three Fill Buckets: Solid (the color in hand, plain or through a one-color pattern), Blend and
    Pattern
  - stickers you can move, resize and flip before they become part of the picture
  - your own pictures, from the device or from Immich, placed the same way and painted over
  - over 2,000 rubber stamps, over 900 stickers and 180 backgrounds
  - Undo Guy

  What you paint is added to the drawing when you leave the mode.

Each page is still an ordinary `.canvas.png` attachment, so stock Memos shows every drawing.

### Inline PDFs

A PDF attached to a memo shows in the memo, one page at a time, with page turning, open and
download. PDFs load only when they scroll into view.

## Your data stays stock Memos

The fork never changes the database schema. Its extras are kept where stock Memos ignores them:

- **Settings and connections:** each user's settings and connections are stored as rows in
  Memos' existing settings table.
- **Content:** ordinary memos, tags and attachments.
- **Some display choices:** kept in your browser.

To go back, point a stock Memos image at the same data folder. Use a version at least as new as
the fork's last upstream sync. You keep every memo, entry, mood tag, drawing and photo. Only the
fork's extra features and settings go away.

## Install

With Docker installed, run:

```bash
docker run -d \
  --name memos \
  -p 5230:5230 \
  -v ~/.memos:/var/opt/memos \
  ghcr.io/9retirement6irk/memos:main
```

Open http://localhost:5230 and create the first account. Everything Memos keeps is in `~/.memos`,
so back up that one folder.

**Updates:** every change to `main` publishes a new `ghcr.io/9retirement6irk/memos:main` image
(also tagged with its short commit). Pull it and restart the container to update. Upstream
changes arrive through a daily pull request and reach the image once it's merged.

Memos' own [deployment guide](https://usememos.com/docs/deploy) covers Docker Compose and reverse
proxies. Use this image in place of `neosmemo/memos`.

## What it connects to

The fork's extras reach outside your server only when you use them:

| Service | When | What it sends |
| --- | --- | --- |
| Immich, Dawarich, Home Assistant | After you connect them in Settings | Requests from the Memos server, with the key you gave it. Keys never go back to the browser. |
| [Open-Meteo](https://open-meteo.com) | Weather in a journal entry | The entry's place and hour, from your browser |
| [Nominatim](https://nominatim.openstreetmap.org) (OpenStreetMap) | Searching for, or naming, a place | The search text or coordinates, from your browser |
| OpenStreetMap tiles | Route maps with the map turned on | The map area shown, from your browser |

Addresses you enter for Immich, Dawarich and Home Assistant are checked before the server
connects. Loopback, link-local and cloud metadata addresses are refused, and redirects are
followed only on the same host.

## Based on Memos

### Simple note-taking for your everyday thoughts.

Memos is an open-source, self-hosted note-taking app that brings your everyday thoughts together in a personal timeline. Your data stays yours, and you choose what to keep private or share.

All the credit for Memos itself goes to its authors. For help with Memos itself, see its
[docs](https://usememos.com/docs), [Discord](https://discord.gg/tfPJa4UmAv) and
[GitHub](https://github.com/usememos/memos), and consider
[sponsoring it](https://github.com/sponsors/usememos). Problems with this fork's own features
belong in [this repository's issues](../../issues), not upstream's.

## License

Memos is open source under the [MIT License](LICENSE). This fork's own code is under the same
license, and so are the files made for it: the notebook paper backgrounds in
`web/src/components/DrawingSheet/paper/` and the hand-drawn SVGs in `web/src/themes/aero/`
(the check marks and the window caption buttons).

### Third-party assets

The MIT License does not cover the files below. They belong to their owners, who keep all
rights in them, and they are not licensed for reuse. They are here for a personal,
non-commercial project. This fork is not affiliated with, sponsored or endorsed by Microsoft
or The Software MacKiev Company.

**Windows Vista icons and pictures:** © Microsoft Corporation.

- Files: the PNGs in `web/src/themes/aero/icons/`, `aero/toolbar/`, `aero/ui/` and `aero/app/`.
  The Aero themes use them.
- The files in `icons/` are named after the Windows resource each was taken from: `imageres_3.png`
  is icon 3 in `imageres.dll`.
  Some were taken from the [windows-ui-assets](https://github.com/bartekl1/windows-ui-assets)
  collection, whose MIT license covers its own text, not the pictures.
- Windows and Windows Vista are trademarks of the Microsoft group of companies.

**Kid Pix:** art, fonts and sounds from *Kid Pix Deluxe 4* (Riverdeep / The Learning Company, 2004).

- Kid Pix was created by Craig Hickman and first published by Brøderbund. The Software
  MacKiev Company now owns it and publishes current versions at [mackiev.com](https://www.mackiev.com/kidpix/).
- Files: `web/public/kidpix/` (stamps, stickers, backgrounds and spray art) and
  `web/src/components/DrawingSheet/kidpix/assets/` (the interface art, the eight fonts and the
  sounds).
- The tables generated into `kidpix/data.ts` and `kidpix/library.ts` were read from the same
  disc. The Kid Pix mode code around them is this fork's own.
- Kid Pix is a trademark of its owner.

If you hold rights in any of these files and want them removed, please
[open an issue](../../issues/new) and they will be taken out.
