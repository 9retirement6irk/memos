// Generated from Brushes.MHK and KP.cfg; see README.md. Do not edit by hand.

/** One Realistic brush: where its three tip sizes sit in assets/brush-tips.png, and its settings. */
export interface RealisticBrush {
  /** [x, y, width, height] of the small, medium and large tip. */
  tips: readonly (readonly [number, number, number, number])[];
  /** Drawing px between presses along a stroke. */
  spacing: number;
  /** The cfg's `oscillation`: how far a press may land from the stroke. */
  wander: number;
  /** [offset, bias]: a dark copy of the tip this far down and right, at 1/bias strength; 0 for none. */
  shadow: readonly [number, number];
  /** The cfg's `densityBias`: the tip marks at 1/density strength. */
  density: number;
  /** The cfg's `spatter`: when set, pixels are dropped at random instead of all being thinned. */
  spatter: number;
}

/** Tools 0 to 19, in tray order: RealBrush, Airbrush, BristleBrush, ExtrusionBrush, CustomBrush1 to 16. */
export const REALISTIC_BRUSHES: readonly RealisticBrush[] = [
  {
    tips: [
      [32, 0, 14, 13],
      [32, 32, 17, 19],
      [32, 64, 28, 28],
    ],
    spacing: 1,
    wander: 0,
    shadow: [0, 0],
    density: 1,
    spatter: 0,
  },
  {
    tips: [
      [0, 0, 10, 10],
      [0, 32, 15, 15],
      [0, 64, 23, 23],
    ],
    spacing: 1,
    wander: 2,
    shadow: [0, 7],
    density: 4,
    spatter: 1,
  },
  {
    tips: [
      [224, 0, 13, 11],
      [224, 32, 20, 19],
      [224, 64, 30, 27],
    ],
    spacing: 1,
    wander: 0,
    shadow: [0, 10],
    density: 1,
    spatter: 0,
  },
  {
    tips: [
      [128, 0, 10, 9],
      [128, 32, 15, 14],
      [128, 64, 21, 20],
    ],
    spacing: 3,
    wander: 0,
    shadow: [3, 2],
    density: 1,
    spatter: 0,
  },
  {
    tips: [
      [544, 0, 11, 12],
      [544, 32, 15, 16],
      [544, 64, 20, 20],
    ],
    spacing: 3,
    wander: 3,
    shadow: [7, 12],
    density: 1,
    spatter: 0,
  },
  {
    tips: [
      [608, 0, 8, 8],
      [608, 32, 12, 12],
      [608, 64, 16, 16],
    ],
    spacing: 1,
    wander: 0,
    shadow: [3, 7],
    density: 1,
    spatter: 0,
  },
  {
    tips: [
      [160, 0, 8, 7],
      [160, 32, 12, 12],
      [160, 64, 14, 14],
    ],
    spacing: 1,
    wander: 0,
    shadow: [20, 30],
    density: 1,
    spatter: 0,
  },
  {
    tips: [
      [288, 0, 12, 12],
      [288, 32, 15, 15],
      [288, 64, 20, 20],
    ],
    spacing: 4,
    wander: 5,
    shadow: [2, 1],
    density: 1,
    spatter: 0,
  },
  {
    tips: [
      [320, 0, 14, 15],
      [320, 32, 18, 19],
      [320, 64, 25, 25],
    ],
    spacing: 6,
    wander: 6,
    shadow: [3, 2],
    density: 1,
    spatter: 0,
  },
  {
    tips: [
      [224, 0, 13, 11],
      [224, 32, 20, 19],
      [224, 64, 30, 27],
    ],
    spacing: 4,
    wander: 8,
    shadow: [2, 3],
    density: 1,
    spatter: 0,
  },
  {
    tips: [
      [32, 0, 14, 13],
      [32, 32, 17, 19],
      [32, 64, 28, 28],
    ],
    spacing: 2,
    wander: 4,
    shadow: [1, 5],
    density: 1,
    spatter: 0,
  },
  {
    tips: [
      [64, 0, 14, 14],
      [64, 32, 17, 17],
      [64, 64, 23, 23],
    ],
    spacing: 5,
    wander: 8,
    shadow: [3, 3],
    density: 1,
    spatter: 0,
  },
  {
    tips: [
      [192, 0, 8, 9],
      [192, 32, 12, 13],
      [192, 64, 17, 18],
    ],
    spacing: 2,
    wander: 5,
    shadow: [10, 15],
    density: 1,
    spatter: 0,
  },
  {
    tips: [
      [96, 0, 7, 13],
      [96, 32, 9, 19],
      [96, 64, 13, 25],
    ],
    spacing: 1,
    wander: 4,
    shadow: [8, 7],
    density: 1,
    spatter: 0,
  },
  {
    tips: [
      [128, 0, 10, 9],
      [128, 32, 15, 14],
      [128, 64, 21, 20],
    ],
    spacing: 5,
    wander: 5,
    shadow: [4, 3],
    density: 2,
    spatter: 0,
  },
  {
    tips: [
      [576, 0, 8, 7],
      [576, 32, 14, 11],
      [576, 64, 20, 14],
    ],
    spacing: 2,
    wander: 8,
    shadow: [4, 20],
    density: 5,
    spatter: 0,
  },
  {
    tips: [
      [352, 0, 13, 12],
      [352, 32, 17, 17],
      [352, 64, 22, 21],
    ],
    spacing: 20,
    wander: 30,
    shadow: [0, 0],
    density: 1,
    spatter: 0,
  },
  {
    tips: [
      [128, 0, 10, 9],
      [128, 32, 15, 14],
      [128, 64, 21, 20],
    ],
    spacing: 2,
    wander: 2,
    shadow: [3, 2],
    density: 1,
    spatter: 1,
  },
  {
    tips: [
      [0, 0, 10, 10],
      [0, 32, 15, 15],
      [0, 64, 23, 23],
    ],
    spacing: 2,
    wander: 0,
    shadow: [10, 4],
    density: 1,
    spatter: 3,
  },
  {
    tips: [
      [224, 0, 13, 11],
      [224, 32, 20, 19],
      [224, 64, 30, 27],
    ],
    spacing: 1,
    wander: 5,
    shadow: [0, 0],
    density: 2,
    spatter: 0,
  },
];
