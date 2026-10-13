// Dartboard geometry, and converting an image point into a score.
//
// Board coordinate system ("board space"):
//   board centre = (0, 0)
//   X axis to the right, Y axis DOWN (as on screen)
//   radius 1.0 = outer edge of the double ring (170 mm on a real board)
//   point (0, -1) lies in the middle of bed 20 (top of the board)

/** Sector order, clockwise, starting from 20 (top). */
export const SEGMENTS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

/**
 * Ring radii normalised to the outer edge of the double ring (170 mm).
 * Base dimensions (mm): bull 12.7 dia., 25 -> 31.8 dia., triple 99-107, double 162-170.
 */
export const RADII = {
  innerBull: 6.35 / 170,   // 0.0374  -> 50 pts
  outerBull: 15.9 / 170,   // 0.0935  -> 25 pts
  tripleInner: 99 / 170,   // 0.5824
  tripleOuter: 107 / 170,  // 0.6294
  doubleInner: 162 / 170,  // 0.9529
  doubleOuter: 1
};

/** Sector number in which the board point (x, y) lies. */
export function segmentAt(x, y) {
  const deg = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360; // 0 = top, increasing clockwise
  return SEGMENTS[Math.floor((deg + 9) / 18) % 20];
}

/** Angle (in degrees, 0 = top, clockwise) of the centre of the sector with the given index. */
export function segmentCenterAngle(index) {
  return index * 18;
}

/**
 * Below this distance from a bed boundary a hit is marked as uncertain.
 * 0.012 of the radius is about 2 mm on a real board, roughly the combined error
 * of recognising the board and locating the tip, so right next to a wire the
 * result may jump to the neighbouring bed. The rings are 8 mm wide, so a hit
 * in the middle of a double or triple still counts as certain.
 */
export const UNCERTAIN_MARGIN = 0.012;

const RING_BOUNDARIES = [
  RADII.innerBull, RADII.outerBull,
  RADII.tripleInner, RADII.tripleOuter,
  RADII.doubleInner, RADII.doubleOuter
];

/** Distance of a point from the nearest bed boundary, in board radii. */
export function boundaryMargin(x, y) {
  const radius = Math.hypot(x, y);
  const radial = Math.min(...RING_BOUNDARIES.map((b) => Math.abs(radius - b)));

  // There are no sector boundaries inside the bull, so only the radius matters.
  if (radius <= RADII.outerBull) return radial;

  const deg = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
  const within = (deg + 9) % 18;
  const angular = radius * (Math.min(within, 18 - within) * Math.PI) / 180;
  return Math.min(radial, angular);
}

/**
 * Score for the point (x, y) in board coordinates.
 * @returns {{points:number, ring:string, sector:number, label:string, radius:number, margin:number, uncertain:boolean}}
 */
export function scoreAtBoard(x, y) {
  const radius = Math.hypot(x, y);
  const margin = boundaryMargin(x, y);
  const uncertain = margin < UNCERTAIN_MARGIN;
  const base = { radius, margin, uncertain };

  if (radius <= RADII.innerBull) {
    return { ...base, points: 50, ring: 'bull', sector: 50, label: 'BULL' };
  }
  if (radius <= RADII.outerBull) {
    return { ...base, points: 25, ring: 'outerBull', sector: 25, label: '25' };
  }
  if (radius > RADII.doubleOuter) {
    return { ...base, points: 0, ring: 'out', sector: 0, label: 'MISS' };
  }

  const sector = segmentAt(x, y);

  if (radius >= RADII.doubleInner) {
    return { ...base, points: sector * 2, ring: 'double', sector, label: `D${sector}` };
  }
  if (radius >= RADII.tripleInner && radius <= RADII.tripleOuter) {
    return { ...base, points: sector * 3, ring: 'triple', sector, label: `T${sector}` };
  }
  return { ...base, points: sector, ring: 'single', sector, label: String(sector) };
}

/** A bed described by number and multiplier, for manual fixes. */
export function scoreFor(sector, ring) {
  if (ring === 'bull') return { points: 50, ring: 'bull', sector: 50, label: 'BULL' };
  if (ring === 'outerBull') return { points: 25, ring: 'outerBull', sector: 25, label: '25' };
  if (ring === 'out') return { points: 0, ring: 'out', sector: 0, label: 'MISS' };
  if (ring === 'double') return { points: sector * 2, ring: 'double', sector, label: `D${sector}` };
  if (ring === 'triple') return { points: sector * 3, ring: 'triple', sector, label: `T${sector}` };
  return { points: sector, ring: 'single', sector, label: String(sector) };
}

/**
 * The most likely fixes for a hit: mistakes happen at the edges, so the other
 * rings of the same number come first, followed by the neighbouring numbers
 * in the same ring.
 */
export function alternativesFor(score) {
  const list = [];
  const add = (candidate) => {
    if (candidate.label !== score.label && !list.some((c) => c.label === candidate.label)) {
      list.push(candidate);
    }
  };

  if (score.ring === 'bull' || score.ring === 'outerBull') {
    add(scoreFor(50, 'bull'));
    add(scoreFor(25, 'outerBull'));
    add(scoreFor(20, 'single'));
  } else if (score.sector) {
    for (const ring of ['single', 'triple', 'double']) add(scoreFor(score.sector, ring));

    const index = SEGMENTS.indexOf(score.sector);
    if (index >= 0) {
      const ring = score.ring === 'out' ? 'double' : score.ring;
      add(scoreFor(SEGMENTS[(index + 19) % 20], ring));
      add(scoreFor(SEGMENTS[(index + 1) % 20], ring));
    }
  }

  add(scoreFor(0, 'out'));
  return list.slice(0, 6);
}

// ---------------------------------------------------------------------------
// Homography: camera image (any angle, perspective) <-> board plane
// ---------------------------------------------------------------------------

/**
 * Solves the linear system A*x = b by Gaussian elimination
 * with partial pivoting.
 */
function solveLinearSystem(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return null; // singular system
    [M[col], M[pivot]] = [M[pivot], M[col]];

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col] / M[col][col];
      if (factor === 0) continue;
      for (let k = col; k <= n; k++) M[row][k] -= factor * M[col][k];
    }
  }
  return M.map((row, i) => row[n] / M[i][i]);
}

/**
 * Computes the homography mapping 4 source points onto 4 target points.
 * @param {Array<[number,number]>} src
 * @param {Array<[number,number]>} dst
 * @returns {number[]|null} the 9 coefficients of the 3x3 matrix (h8 = 1)
 */
export function solveHomography(src, dst) {
  if (src.length !== 4 || dst.length !== 4) throw new Error('A homography needs exactly 4 points');

  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  const h = solveLinearSystem(A, b);
  return h ? [...h, 1] : null;
}

/** Maps the point [x, y] through a homography. */
export function applyHomography(h, [x, y]) {
  const w = h[6] * x + h[7] * y + h[8];
  if (Math.abs(w) < 1e-12) return [NaN, NaN];
  return [
    (h[0] * x + h[1] * y + h[2]) / w,
    (h[3] * x + h[4] * y + h[5]) / w
  ];
}

// ---------------------------------------------------------------------------
// 3x3 matrix algebra, needed for automatic board recognition
// ---------------------------------------------------------------------------

/** Product of 3x3 matrices stored as 9 numbers (row by row). */
export function multiply(a, b) {
  const out = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

/** Inverse of a 3x3 matrix (via the adjugate), normalised so that h8 = 1. */
export function invert(h) {
  const [a, b, c, d, e, f, g, i, j] = h;
  const A = e * j - f * i;
  const B = -(d * j - f * g);
  const C = d * i - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-14) return null;

  const inv = [
    A, -(b * j - c * i), b * f - c * e,
    B, a * j - c * g, -(a * f - c * d),
    C, -(a * i - b * g), a * e - b * d
  ].map((v) => v / det);

  const scale = inv[8];
  return Math.abs(scale) > 1e-14 ? inv.map((v) => v / scale) : inv;
}

/** Rotation by the given angle (in degrees, clockwise on screen). */
export function rotation(angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return [cos, -sin, 0, sin, cos, 0, 0, 0, 1];
}

/**
 * A projective transform that keeps the unit circle and moves the board centre
 * to the point (ax, ay) inside that circle (a translation in the Klein model).
 *
 * This is exactly the part of the homography the outline ellipse alone cannot
 * show: the ellipse says how squashed the board is, and the bull's offset from
 * the ellipse centre says from what angle the camera is looking.
 */
export function circlePreservingShift(ax, ay) {
  const t = Math.hypot(ax, ay);
  if (t < 1e-9) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (t >= 0.999) return null; // point outside the board; the measurement makes no sense

  const alpha = (Math.atan2(ay, ax) * 180) / Math.PI;
  const shrink = Math.sqrt(1 - t * t);
  const shift = [1, 0, t, 0, shrink, 0, t, 0, 1];
  return multiply(rotation(alpha), multiply(shift, rotation(-alpha)));
}

/**
 * Affine transform mapping the unit circle onto an ellipse with the
 * given centre, semi-axes and tilt.
 */
export function affineFromEllipse({ cx, cy, rx, ry, tilt }) {
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  return [
    rx * cos, -ry * sin, cx,
    rx * sin, ry * cos, cy,
    0, 0, 1
  ];
}

/** Solves the overdetermined system A·x = b by least squares. */
export function solveLeastSquares(rows, values) {
  const n = rows[0].length;
  const AtA = Array.from({ length: n }, () => new Array(n).fill(0));
  const Atb = new Array(n).fill(0);

  for (let k = 0; k < rows.length; k++) {
    const row = rows[k];
    const value = values[k];
    for (let i = 0; i < n; i++) {
      Atb[i] += row[i] * value;
      for (let j = 0; j < n; j++) AtA[i][j] += row[i] * row[j];
    }
  }
  return solveLinearSystem(AtA, Atb);
}

/** Score for a point tapped on the camera image. */
export function scoreAtImage(calibration, x, y) {
  const [bx, by] = applyHomography(calibration.imageToBoard, [x, y]);
  if (!Number.isFinite(bx) || !Number.isFinite(by)) {
    return { points: 0, ring: 'out', sector: 0, label: 'MISS', radius: Infinity, board: [bx, by] };
  }
  return { ...scoreAtBoard(bx, by), board: [bx, by] };
}
