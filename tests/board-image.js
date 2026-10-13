// Test helper: draws a synthetic board seen through a given homography.
// That way we know the true transform and can check how much of it
// automatic recognition recovers.

import { SEGMENTS, RADII, applyHomography, invert } from '../public/js/geometry.js';

const COLORS = {
  wall: [120, 118, 112],
  surround: [24, 24, 26],
  black: [28, 28, 32],
  cream: [226, 211, 171],
  red: [186, 42, 38],
  green: [38, 120, 58],
  bull: [198, 40, 40],
  outerBull: [38, 120, 58]
};

const NUMBER_COLOR = [225, 225, 220];

/**
 * @param {object} style
 * @param {boolean} style.reversed bed 20 light with green rings, as on some soft-tip boards
 * @param {object} style.colors overrides for COLORS
 * @param {Array<{from:number,to:number,color:number[]}>} style.rings extra rings outside the board (a coloured surround)
 */
function colorAt(x, y, { reversed = false, colors = COLORS, rings = [] } = {}) {
  const r = Math.hypot(x, y);
  for (const ring of rings) if (r > ring.from && r <= ring.to) return ring.color;
  if (r > 1.28) return colors.wall;

  const deg = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
  const index = Math.floor((deg + 9) / 18) % 20;

  if (r > 1.0) {
    // The printed number: a block as wide as its digits, the way a real one reads at low resolution.
    const offset = Math.abs(((deg - index * 18 + 540) % 360) - 180);
    const halfWidth = 2.2 * String(SEGMENTS[index]).length;
    if (r > 1.08 && r < 1.2 && offset <= halfWidth) return NUMBER_COLOR;
    return colors.surround;
  }

  if (r <= RADII.innerBull) return colors.bull;
  if (r <= RADII.outerBull) return colors.outerBull;

  const dark = (index % 2 === 0) !== reversed;

  if (r >= RADII.doubleInner || (r >= RADII.tripleInner && r <= RADII.tripleOuter)) {
    return dark ? colors.red : colors.green;
  }
  return dark ? colors.black : colors.cream;
}

/**
 * @param {number[]} boardToImage board → image homography
 * @param {{width:number, height:number, noise?:number, seed?:number, reversed?:boolean,
 *   colors?:object, rings?:Array, tint?:number[], clutter?:Array<{x:number,y:number,w:number,h:number,color:number[]}>}} options
 *   `tint` multiplies the channels (coloured light); `clutter` paints rectangles in image pixels.
 */
export function renderBoard(boardToImage, {
  width = 480,
  height = 360,
  noise = 6,
  seed = 7,
  reversed = false,
  colors = {},
  rings = [],
  tint = [1, 1, 1],
  clutter = []
} = {}) {
  const style = { reversed, colors: { ...COLORS, ...colors }, rings };
  const imageToBoard = invert(boardToImage);
  const data = new Uint8ClampedArray(width * height * 4);

  // A simple deterministic noise generator: the tests must be repeatable.
  let state = seed;
  const rand = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff - 0.5;
  };

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const [bx, by] = applyHomography(imageToBoard, [px + 0.5, py + 0.5]);
      const patch = clutter.find((c) => px >= c.x && px < c.x + c.w && py >= c.y && py < c.y + c.h);
      const base = patch ? patch.color : Number.isFinite(bx) ? colorAt(bx, by, style) : style.colors.wall;
      const i = (py * width + px) * 4;
      data[i] = base[0] * tint[0] + rand() * noise;
      data[i + 1] = base[1] * tint[1] + rand() * noise;
      data[i + 2] = base[2] * tint[2] + rand() * noise;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

/**
 * Draws a dart the way it really looks in a camera image:
 *  - needle: one or two pixels, blurred by the lens, so its difference from the
 *    background is small (below the threshold used for the rest of the dart),
 *  - barrel: thick and bright,
 *  - shaft: dark; on a black bed it practically disappears, so the dart
 *    breaks up into separate pieces,
 *  - flights: bright and wide.
 */
export function drawRealisticDart(image, tipX, tipY, dirX, dirY, { needleContrast = 0.14, scale = 1 } = {}) {
  // Coverage is collected in a map first and only then blended with the background;
  // otherwise overlapping strokes would add up and the "barely visible" needle
  // would come out perfectly clear.
  const coverage = new Map();
  const paint = (x, y, rgb, alpha) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= image.width || py >= image.height) return;
    const key = py * image.width + px;
    const current = coverage.get(key);
    if (!current || alpha > current.alpha) coverage.set(key, { rgb, alpha });
  };
  const segment = (from, to, halfWidth, rgb, alpha) => {
    for (let t = from * scale; t <= to * scale; t += 0.4) {
      for (let w = -halfWidth; w <= halfWidth; w += 0.4) {
        paint(tipX + dirX * t - dirY * w, tipY + dirY * t + dirX * w, rgb, alpha);
      }
    }
  };

  segment(0, 8, 0.6, [170, 170, 175], needleContrast);   // protruding needle
  segment(8, 26, 2.5, [205, 205, 210], 1);               // barrel
  segment(26, 36, 2.0, [40, 40, 44], 1);                 // shaft (dark)
  segment(36, 52, 5.0, [235, 235, 240], 1);              // flights

  for (const [key, { rgb, alpha }] of coverage) {
    const i = key * 4;
    for (let c = 0; c < 3; c++) image.data[i + c] = image.data[i + c] * (1 - alpha) + rgb[c] * alpha;
  }
  return image;
}

/** Draws a "dart": a bright stroke from the tip in the given direction. */
export function drawDart(image, tipX, tipY, dx, dy, { thickness = 3, color = [235, 235, 240] } = {}) {
  const steps = Math.ceil(Math.hypot(dx, dy));
  for (let s = 0; s <= steps; s++) {
    const x = tipX + (dx * s) / steps;
    const y = tipY + (dy * s) / steps;
    for (let oy = -thickness; oy <= thickness; oy++) {
      for (let ox = -thickness; ox <= thickness; ox++) {
        const px = Math.round(x + ox);
        const py = Math.round(y + oy);
        if (px < 0 || py < 0 || px >= image.width || py >= image.height) continue;
        const i = (py * image.width + px) * 4;
        image.data[i] = color[0];
        image.data[i + 1] = color[1];
        image.data[i + 2] = color[2];
      }
    }
  }
  return image;
}

/** A copy of a frame, for building "background → dart" sequences. */
export function cloneImage(image) {
  return { data: new Uint8ClampedArray(image.data), width: image.width, height: image.height };
}
