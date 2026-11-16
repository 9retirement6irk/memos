// Generated from the disc's StampEd.MHK. Do not edit by hand.

/** A part of the Stamp Editor: where it is in assets/stamp-editor.png (x, y, width, height). */
export type StampEditorCell = readonly [number, number, number, number];

export const STAMP_EDITOR = {
  sheet: [682, 554],
  window: [0, 0, 516, 346],
  /** The 256 px drawing square and the 32 px preview, on the window. */
  canvas: [166, 25],
  preview: [457, 25],
  /** The color grid: its cell, and where it sits on the window. */
  palette: { cell: [555, 379, 127, 175], at: [32, 151] },
  /** Each button at rest, pressed and pointed at: its cell and where that sits on the window; and its clip. */
  buttons: {
    pencil: {
      states: [
        [517, 0, 23, 26, 61, 25],
        [541, 0, 27, 30, 59, 23],
        [569, 0, 23, 26, 61, 25],
      ],
      clip: "stamped14002",
    },
    bucket: {
      states: [
        [593, 0, 27, 28, 104, 23],
        [621, 0, 31, 30, 102, 22],
        [653, 0, 27, 28, 104, 23],
      ],
      clip: "stamped14002",
    },
    undo: {
      states: [
        [0, 347, 29, 25, 58, 65],
        [30, 347, 33, 29, 56, 63],
        [64, 347, 29, 25, 58, 65],
      ],
      clip: "stamped14002",
    },
    firecracker: {
      states: [
        [94, 347, 27, 28, 104, 63],
        [122, 347, 29, 31, 103, 62],
        [152, 347, 27, 28, 104, 63],
      ],
      clip: "stamped14002",
    },
    flip: {
      states: [
        [180, 347, 32, 23, 56, 106],
        [213, 347, 36, 27, 54, 104],
        [250, 347, 32, 23, 56, 106],
      ],
      clip: "stamped14005",
    },
    rotate: {
      states: [
        [283, 347, 28, 24, 102, 104],
        [312, 347, 32, 28, 100, 102],
        [345, 347, 28, 24, 102, 104],
      ],
      clip: "stamped14003",
    },
    restore: {
      states: [
        [374, 347, 128, 24, 170, 293],
        [503, 347, 128, 24, 170, 293],
        [0, 379, 128, 24, 170, 293],
      ],
      clip: "stamped14004",
    },
    cancel: {
      states: [
        [129, 379, 70, 24, 313, 293],
        [200, 379, 70, 24, 313, 293],
        [271, 379, 70, 24, 313, 293],
      ],
      clip: "stamped14000",
    },
    ok: {
      states: [
        [342, 379, 70, 24, 393, 293],
        [413, 379, 70, 24, 393, 293],
        [484, 379, 70, 24, 393, 293],
      ],
      clip: "stamped14001",
    },
  },
} as const;
