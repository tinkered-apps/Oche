// Automatic board recognition in the frame, without a single tap.
//
// Idea: the only strongly saturated colours on a board are the red and green
// (on some soft-tip boards blue) beds of the double, the triple and the bull.
// From them we derive:
//   1. the ellipse of the outer double-ring edge     → the affine part,
//   2. the bull centre                               → the perspective part,
//   3. the red/green alternation around the board    → rotation (where 20 is).
//
// The ellipse says how much the board is squashed in the frame, but not from
// which side the camera is looking; that is carried by the bull's offset from
// the ellipse centre. Together they give a full homography.
//
// A real frame holds more than the board: coloured surrounds and walls, logos,
// flights, warm light that tints the sisal. So the search does not trust any
// single cue. It removes large single-coloured areas, tries a few candidate
// centres, and keeps the pose whose whole bed layout best matches the frame.

import {
  RADII,
  multiply,
  invert,
  rotation,
  circlePreservingShift,
  affineFromEllipse,
  solveLeastSquares,
  applyHomography
} from './geometry.js';

/** Ring centres where colour is sampled when looking for the board's rotation. */
const DOUBLE_MID = (RADII.doubleInner + RADII.doubleOuter) / 2;
const TRIPLE_MID = (RADII.tripleInner + RADII.tripleOuter) / 2;

const RED = 1;
const GREEN = 2;

/**
 * Classifies a pixel as a red bed, a green bed or "not interesting".
 * Works on hue, so warm light (which turns sisal and wood orange) does not
 * make them red. "Green" also covers blue, which some soft-tip boards use
 * in place of green.
 */
export function classifyColor(r, g, b) {
  const max = Math.max(r, g, b);
  if (max < 40) return null;
  const min = Math.min(r, g, b);
  const chroma = max - min;
  const saturation = chroma / max;
  if (saturation < 0.25 || chroma < 22) return null;

  let hue;
  if (max === r) hue = (60 * (g - b)) / chroma;
  else if (max === g) hue = 120 + (60 * (b - r)) / chroma;
  else hue = 240 + (60 * (r - g)) / chroma;
  if (hue < 0) hue += 360;

  if ((hue <= 18 || hue >= 330) && saturation >= 0.3) return 'red';
  if (hue >= 75 && hue <= 250) return 'green';
  return null;
}

function classifyAt(image, x, y) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= image.width || py >= image.height) return null;
  const i = (py * image.width + px) * 4;
  return classifyColor(image.data[i], image.data[i + 1], image.data[i + 2]);
}

/** Fits an ellipse to a set of points (algebraic least squares). */
export function fitEllipse(points, origin, scale) {
  if (points.length < 12) return null;

  const rows = [];
  const values = [];
  for (const [px, py] of points) {
    const x = (px - origin[0]) / scale;
    const y = (py - origin[1]) / scale;
    rows.push([x * x, x * y, y * y, x, y]);
    values.push(1);
  }

  const solution = solveLeastSquares(rows, values);
  if (!solution) return null;

  const [A, B, C, D, E] = solution;
  const F = -1;

  const disc = B * B - 4 * A * C;
  if (!(disc < 0)) return null; // not an ellipse

  const cx = (2 * C * D - B * E) / disc;
  const cy = (2 * A * E - B * D) / disc;

  // Semi-axes from the determinants of the conic matrix.
  const detM = A * (C * F - (E / 2) * (E / 2))
    - (B / 2) * ((B / 2) * F - (E / 2) * (D / 2))
    + (D / 2) * ((B / 2) * (E / 2) - C * (D / 2));
  const detM0 = A * C - (B / 2) * (B / 2);
  if (Math.abs(detM0) < 1e-12) return null;

  const mid = (A + C) / 2;
  const gap = Math.hypot((A - C) / 2, B / 2);
  const lambda1 = mid - gap;
  const lambda2 = mid + gap;

  const axis = (lambda) => {
    const value = -detM / (detM0 * lambda);
    return value > 0 ? Math.sqrt(value) : NaN;
  };
  const r1 = axis(lambda1);
  const r2 = axis(lambda2);
  if (!Number.isFinite(r1) || !Number.isFinite(r2)) return null;

  const tilt = Math.abs(B) < 1e-12 && Math.abs(A - C) < 1e-12
    ? 0
    : Math.atan2(lambda1 - A, B / 2);

  return {
    cx: cx * scale + origin[0],
    cy: cy * scale + origin[1],
    rx: r1 * scale,
    ry: r2 * scale,
    tilt
  };
}

/** How far a point lies from an ellipse, as a fraction of its radius (0 = on it). */
function ellipseResidual(ellipse, [x, y]) {
  const cos = Math.cos(ellipse.tilt);
  const sin = Math.sin(ellipse.tilt);
  const dx = x - ellipse.cx;
  const dy = y - ellipse.cy;
  const u = (dx * cos + dy * sin) / ellipse.rx;
  const v = (-dx * sin + dy * cos) / ellipse.ry;
  return Math.abs(Math.hypot(u, v) - 1);
}

/**
 * Coloured pixels of the frame, grouped into connected regions of one colour.
 * Large regions are dropped: a bed of the double or triple ring is a short arc,
 * while a coloured surround, a wall or a cabinet is one big area.
 */
function colourRegions(image) {
  const { width, height, data } = image;
  const kind = new Uint8Array(width * height);
  let coloured = 0;
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const k = classifyColor(data[i], data[i + 1], data[i + 2]);
    if (!k) continue;
    kind[p] = k === 'red' ? RED : GREEN;
    coloured++;
  }

  const maxSide = Math.min(width, height) * 0.3;
  const kept = new Uint8Array(width * height);
  const points = [];
  const blobs = [];
  const visited = new Uint8Array(width * height);
  const stack = [];
  const members = [];

  for (let start = 0; start < kind.length; start++) {
    if (!kind[start] || visited[start]) continue;
    const k = kind[start];
    visited[start] = 1;
    stack.push(start);
    members.length = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;

    while (stack.length) {
      const p = stack.pop();
      members.push(p);
      const px = p % width;
      const py = (p - px) / width;
      sumX += px;
      sumY += py;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (kind[q] === k && !visited[q]) {
            visited[q] = 1;
            stack.push(q);
          }
        }
      }
    }

    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    if (Math.max(boxWidth, boxHeight) > maxSide) continue;

    for (const p of members) {
      kept[p] = k;
      points.push(p);
    }
    const count = members.length;
    blobs.push({
      kind: k,
      count,
      x: sumX / count,
      y: sumY / count,
      boxWidth,
      boxHeight
    });
  }

  return { kind: kept, points, blobs, coloured };
}

/**
 * Candidate board centres. The strongest cue is the bull: a compact blob of one
 * colour ringed by the other. The centroid and the median of all coloured
 * pixels are fallbacks for a frame where the bull is too small to see.
 */
function centreCandidates({ kind, points, blobs }, width) {
  const candidates = [];
  const bulls = [];
  for (const blob of blobs) {
    if (blob.count < 4) continue;
    const elongation = Math.max(blob.boxWidth, blob.boxHeight) / Math.min(blob.boxWidth, blob.boxHeight);
    const fill = blob.count / (blob.boxWidth * blob.boxHeight);
    if (elongation > 1.8 || fill < 0.4) continue;

    // The outer bull reaches 2.5 times as far as the inner one.
    const radius = Math.sqrt(blob.count / Math.PI);
    const other = blob.kind === RED ? GREEN : RED;
    let ringed = 0;
    let samples = 0;
    for (let a = 0; a < 24; a++) {
      const angle = (a / 24) * 2 * Math.PI;
      for (const factor of [1.6, 2.1]) {
        const x = Math.round(blob.x + Math.cos(angle) * radius * factor + Math.cos(angle));
        const y = Math.round(blob.y + Math.sin(angle) * radius * factor + Math.sin(angle));
        samples++;
        if (x >= 0 && y >= 0 && x < width && kind[y * width + x] === other) ringed++;
      }
    }
    if (ringed / samples >= 0.45) bulls.push({ x: blob.x, y: blob.y, score: ringed / samples, count: blob.count });
  }
  bulls.sort((a, b) => b.score * Math.sqrt(b.count) - a.score * Math.sqrt(a.count));
  for (const bull of bulls.slice(0, 4)) candidates.push([bull.x, bull.y]);

  // Where a red bed touches a green one. On the board that happens forty times
  // on the rings and all round the bull; elsewhere in a room it is rare. The
  // densest patch of such points marks the board even when it is small.
  const height = kind.length / width;
  const junctions = [];
  for (const p of points) {
    const x = p % width;
    const y = (p - x) / width;
    if (x < 3 || y < 3 || x >= width - 3 || y >= height - 3) continue;
    const other = kind[p] === RED ? GREEN : RED;
    if (kind[p + 3] === other || kind[p - 3] === other || kind[p + 3 * width] === other || kind[p - 3 * width] === other) {
      junctions.push([x, y]);
    }
  }
  if (junctions.length >= 20) {
    const minSide = Math.min(width, height);
    for (const windowSize of [minSide / 8, minSide / 4, minSide / 2]) {
      const cell = Math.max(4, Math.round(windowSize / 4));
      const cols = Math.ceil(width / cell);
      const rows = Math.ceil(height / cell);
      const grid = new Float64Array(cols * rows);
      for (const [x, y] of junctions) grid[Math.floor(y / cell) * cols + Math.floor(x / cell)]++;
      const sums = [];
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          let sum = 0;
          for (let dr = -2; dr <= 2; dr++) {
            for (let dc = -2; dc <= 2; dc++) {
              const r = row + dr;
              const c = col + dc;
              if (r >= 0 && c >= 0 && r < rows && c < cols) sum += grid[r * cols + c];
            }
          }
          if (sum >= 10) sums.push({ sum, row, col });
        }
      }
      // The few densest patches that do not overlap: clutter can outdo the board.
      sums.sort((a, b) => b.sum - a.sum);
      const peaks = [];
      for (const s of sums) {
        if (peaks.length >= 3) break;
        if (peaks.some((q) => Math.abs(q.row - s.row) <= 4 && Math.abs(q.col - s.col) <= 4)) continue;
        peaks.push(s);
      }
      for (const peak of peaks) {
        const px = (peak.col + 0.5) * cell;
        const py = (peak.row + 0.5) * cell;
        let jx = 0;
        let jy = 0;
        let n = 0;
        for (const [x, y] of junctions) {
          if (Math.abs(x - px) <= 2.5 * cell && Math.abs(y - py) <= 2.5 * cell) {
            jx += x;
            jy += y;
            n++;
          }
        }
        if (n) candidates.push([jx / n, jy / n]);
      }
    }
  }

  let sumX = 0;
  let sumY = 0;
  const xs = [];
  const ys = [];
  for (let i = 0; i < points.length; i++) {
    const x = points[i] % width;
    const y = (points[i] - x) / width;
    sumX += x;
    sumY += y;
    if (i % 3 === 0) {
      xs.push(x);
      ys.push(y);
    }
  }
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  candidates.push([sumX / points.length, sumY / points.length]);
  candidates.push([xs[xs.length >> 1], ys[ys.length >> 1]]);
  return candidates;
}

/**
 * Traces the outer edge of the double ring around a candidate centre.
 * Along each direction the coloured pixels form bands: bull, triple, double,
 * and whatever lies beyond the board. The double ring is the outermost band
 * that has the triple ring at about 0.6 of its radius, a ratio that holds for
 * every board and that a coloured surround or logo does not reproduce.
 */
function traceOutline(regions, width, centre, bins) {
  const { points } = regions;
  const [cx, cy] = centre;
  const radii = Array.from({ length: bins }, () => []);

  for (let i = 0; i < points.length; i++) {
    const x = points[i] % width;
    const y = (points[i] - x) / width;
    const dx = x - cx;
    const dy = y - cy;
    const bin = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * bins) % bins;
    radii[bin].push(Math.hypot(dx, dy));
  }
  for (const list of radii) list.sort((a, b) => a - b);

  // Is there a coloured pixel between `from` and `to` in this or a neighbouring slice?
  const hasBetween = (bin, from, to) => {
    for (let d = -1; d <= 1; d++) {
      const list = radii[(bin + d + bins) % bins];
      let lo = 0;
      let hi = list.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid] < from) lo = mid + 1;
        else hi = mid;
      }
      if (lo < list.length && list[lo] <= to) return true;
    }
    return false;
  };

  const countBetween = (list, from, to) => {
    let n = 0;
    for (const r of list) if (r >= from && r <= to) n++;
    return n;
  };

  // The ratio is 0.6 when the camera faces the board; a strongly oblique view
  // moves it between about 0.5 and 0.69 along different directions.
  const edge = new Array(bins).fill(0);
  for (let bin = 0; bin < bins; bin++) {
    const list = radii[bin];
    for (let i = list.length - 1; i >= 0; i--) {
      const outer = list[i];
      if (outer < 8) break;
      // Find where this band starts.
      let j = i;
      while (j > 0 && list[j] - list[j - 1] <= Math.max(2, outer * 0.03)) j--;
      const inner = list[j];
      const tolerance = Math.max(1, (i - j + 1) * 0.2);
      // Between the triple and the double lies a single bed with no colour, and
      // so does the inner part of the singles. Without the first test a speckled
      // number ring would pass for the double; without the second, a coloured
      // ring at 1.5 times the double's radius would, with the double as its "triple".
      if (outer - inner <= outer * 0.2
        && hasBetween(bin, outer * 0.48, outer * 0.7)
        && countBetween(list, outer * 0.72, Math.min(inner, outer * 0.92)) <= tolerance
        && countBetween(list, outer * 0.2, outer * 0.44) <= tolerance) {
        edge[bin] = outer;
        break;
      }
      i = j;
    }
  }
  return { edge, bins };
}

/** Turns the per-direction edge into outline points, dropping outliers. */
function outlinePoints({ edge, bins: BINS }, centre) {
  const WINDOW = Math.round(BINS / 20); // ±18°
  const localMedian = (bin) => {
    const window = [];
    for (let d = -WINDOW; d <= WINDOW; d++) {
      const r = edge[(bin + d + BINS) % BINS];
      if (r > 0) window.push(r);
    }
    if (window.length < 4) return 0;
    window.sort((a, b) => a - b);
    return window[Math.floor(window.length / 2)];
  };

  // We compare against the LOCAL median, because at an oblique angle the radius
  // varies around the board by up to a factor of two.
  const boundary = [];
  for (let bin = 0; bin < BINS; bin++) {
    const r = edge[bin];
    if (r <= 0) continue;
    const reference = localMedian(bin);
    if (!reference || Math.abs(r - reference) > reference * 0.1) continue;
    const angle = (bin + 0.5) * (2 * Math.PI / BINS) - Math.PI;
    boundary.push([centre[0] + r * Math.cos(angle), centre[1] + r * Math.sin(angle)]);
  }
  return boundary;
}

/** Ellipse fit that drops the worst points and fits again. */
function robustEllipse(boundary, centre) {
  const scale = boundary.reduce((s, [x, y]) => s + Math.hypot(x - centre[0], y - centre[1]), 0) / boundary.length;
  let points = boundary;
  let ellipse = fitEllipse(points, centre, scale);
  for (let round = 0; round < 2 && ellipse; round++) {
    const residuals = points.map((p) => ellipseResidual(ellipse, p));
    const sorted = [...residuals].sort((a, b) => a - b);
    const limit = Math.max(0.025, sorted[Math.floor(sorted.length * 0.8)] * 1.5);
    const inliers = points.filter((_, i) => residuals[i] <= limit);
    if (inliers.length === points.length || inliers.length < 16) break;
    points = inliers;
    ellipse = fitEllipse(points, centre, scale);
  }
  return ellipse && { ellipse, inliers: points.length };
}

/** Stages of the search, so that the most advanced failure is the one reported. */
const FAILURES = ['calib.noBoard', 'calib.partial', 'calib.blurry', 'calib.fitFailed', 'calib.tooFlat',
  'calib.tooSkewed', 'calib.noOrientation', 'calib.failed', 'calib.uncertain'];

/**
 * Looks for the board in an image frame.
 * @param {{data:Uint8ClampedArray|number[], width:number, height:number}} image
 * @returns {{imageToBoard:number[], boardToImage:number[], quality:object}|{error:string}}
 *   On failure `error` is a text key (see i18n.js), not a finished sentence,
 *   so the message is built in the language picked in the header.
 */
export function detectBoard(image) {
  const first = detectIn(image);
  if (!first.error && first.quality.match >= 0.9) return first;

  // Strongly tinted light (a warm bulb) can push the red beds towards orange.
  // A second attempt on a white-balanced copy of the frame gets them back;
  // the pose found there applies to the original frame unchanged.
  const balanced = whiteBalanced(image);
  if (!balanced) return first;
  const second = detectIn(balanced);
  if (second.error) return first;
  if (first.error || second.quality.match > first.quality.match) return second;
  return first;
}

/** A copy of the frame corrected so that its average colour is grey, or null when it already is. */
function whiteBalanced(image) {
  const { data, width, height } = image;
  const sums = [0, 0, 0];
  for (let p = 0; p < width * height; p += 2) {
    const i = p * 4;
    const max = Math.max(data[i], data[i + 1], data[i + 2]);
    if (max < 30 || max > 245) continue;
    sums[0] += data[i];
    sums[1] += data[i + 1];
    sums[2] += data[i + 2];
  }
  const grey = (sums[0] + sums[1] + sums[2]) / 3;
  if (!grey) return null;
  const gains = sums.map((s) => Math.min(1.5, Math.max(0.67, grey / (s || 1))));
  if (gains.every((g) => Math.abs(g - 1) < 0.05)) return null;

  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    out[i] = data[i] * gains[0];
    out[i + 1] = data[i + 1] * gains[1];
    out[i + 2] = data[i + 2] * gains[2];
    out[i + 3] = 255;
  }
  return { data: out, width, height };
}

function detectIn(image) {
  const { width } = image;
  const regions = colourRegions(image);
  let greens = 0;
  for (const p of regions.points) if (regions.kind[p] === GREEN) greens++;
  if (greens < 60 || regions.points.length < 200) {
    return { error: 'calib.noBoard' };
  }

  let best = null;
  let failure = 0;
  const tried = [];
  for (const candidate of centreCandidates(regions, width)) {
    if (tried.some(([x, y]) => Math.hypot(x - candidate[0], y - candidate[1]) < 3)) continue;
    if (tried.length >= 10) break; // bounds the time spent on a frame with no board in it
    tried.push(candidate);

    const result = fitFrom(image, regions, candidate);
    if (result.error) {
      failure = Math.max(failure, FAILURES.indexOf(result.error));
      continue;
    }
    if (!best || result.quality.match > best.quality.match) best = result;
    if (best.quality.match >= 0.97) break;
  }

  if (!best) return { error: FAILURES[failure] };
  if (best.quality.match < 0.75) return { error: 'calib.uncertain' };
  return best;
}

/**
 * The outline ellipse around a candidate centre. The first outline is traced
 * around a guess; tracing again around the fitted ellipse's centre corrects
 * most of the guess's error.
 */
function fitOutline(regions, width, candidate, bins) {
  let centre = candidate;
  let fit = null;
  let boundary = [];
  for (let pass = 0; pass < 3; pass++) {
    const traced = traceOutline(regions, width, centre, bins);
    if (traced.edge.filter((r) => r > 0).length < bins * 0.4) {
      return { error: fit ? 'calib.blurry' : 'calib.partial' };
    }
    boundary = outlinePoints(traced, centre);
    if (boundary.length < bins * 0.22) return { error: 'calib.blurry' };

    const next = robustEllipse(boundary, centre);
    if (!next || !(next.ellipse.rx > 0) || !(next.ellipse.ry > 0)) return { error: 'calib.fitFailed' };
    const moved = Math.hypot(next.ellipse.cx - centre[0], next.ellipse.cy - centre[1]);
    fit = next;
    centre = [next.ellipse.cx, next.ellipse.cy];
    if (moved < 1) break;
  }
  return { ellipse: fit.ellipse, boundary };
}

/** The whole fit, starting from one candidate centre. */
function fitFrom(image, regions, candidate) {
  const { width, height } = image;

  // A small board in the frame leaves too few pixels for fine slices, so a
  // failed trace is retried with coarser ones.
  let outline = fitOutline(regions, width, candidate, 180);
  if (outline.error) {
    const coarse = fitOutline(regions, width, candidate, 72);
    if (!coarse.error) outline = coarse;
  }
  if (outline.error) return outline;

  const { ellipse, boundary } = outline;
  if (!(ellipse.cx > 0 && ellipse.cy > 0 && ellipse.cx < width && ellipse.cy < height)) {
    return { error: 'calib.fitFailed' };
  }
  const squash = Math.min(ellipse.rx, ellipse.ry) / Math.max(ellipse.rx, ellipse.ry);
  if (squash < 0.35) return { error: 'calib.tooFlat' };

  const affine = affineFromEllipse(ellipse);
  const affineInverse = invert(affine);
  if (!affineInverse) return { error: 'calib.failed' };

  // The bull centre is found as a compact blob of coloured pixels near the board
  // centre. Averaging the pixels around the centre is not enough: at an oblique angle
  // the triple ring comes very close on one side and would pull
  // the result towards itself. Without a visible bull the perspective starts
  // from zero and the pattern fit below finds it.
  const bull = findBull(regions.kind, width, height, affineInverse, Math.PI * 0.0935 * 0.0935 * ellipse.rx * ellipse.ry);
  let [shiftX, shiftY] = bull ? applyHomography(affineInverse, bull) : [0, 0];
  if (Math.hypot(shiftX, shiftY) > 0.35) [shiftX, shiftY] = [0, 0];
  const perspective = circlePreservingShift(shiftX, shiftY);
  if (!perspective) return { error: 'calib.tooSkewed' };

  const base = multiply(affine, perspective);
  const phase = findPhase(base, image);
  if (phase === null) return { error: 'calib.noOrientation' };

  // So far everything came from the outline and the bull alone. Now we refine
  // the fit so that the whole layout of the beds (red, green, black
  // and sisal) agrees with what is actually visible in the frame. The pattern
  // itself repeats every 36°, so the fit runs on the pattern and the numbering
  // is settled afterwards.
  const start = {
    cx: ellipse.cx,
    cy: ellipse.cy,
    rx: ellipse.rx,
    ry: ellipse.ry,
    tilt: ellipse.tilt,
    ax: shiftX,
    ay: shiftY,
    spin: phase
  };
  const matchBefore = evaluateFit(image, buildMatrix(start)).score;
  const refined = refineFit(image, start);

  const spin = chooseNumbering(buildMatrix({ ...refined.params, spin: 0 }), refined.params.spin);
  const params = { ...refined.params, spin };
  const boardToImage = buildMatrix(params);
  const imageToBoard = boardToImage && invert(boardToImage);
  if (!imageToBoard) return { error: 'calib.failed' };

  return {
    imageToBoard,
    boardToImage,
    quality: {
      match: refined.score,
      matchBefore,
      samples: refined.samples,
      boundaryPoints: boundary.length,
      ringPixels: regions.points.length,
      squash,
      radius: (params.rx + params.ry) / 2,
      center: [params.cx, params.cy],
      perspectiveShift: Math.hypot(params.ax, params.ay),
      bullFound: Boolean(bull),
      reversedColours: Math.round((((spin - refined.params.spin) % 36) + 36) % 36) === 18
    }
  };
}

/** Builds the board → image homography from eight parameters describing the pose. */
export function buildMatrix({ cx, cy, rx, ry, tilt, ax, ay, spin }) {
  const shift = circlePreservingShift(ax, ay);
  if (!shift) return null;
  return multiply(affineFromEllipse({ cx, cy, rx, ry, tilt }), multiply(shift, rotation(spin)));
}

/**
 * Control points: the centre of every bed in every ring, with the colour
 * expected there on a real board.
 */
function controlPoints() {
  const points = [];
  // Besides bed centres we also sample near the ring edges, so the
  // measure already reacts to a shift of about one percent of the radius,
  // not only to a jump of a whole bed.
  const tripleEdge = (RADII.tripleOuter - RADII.tripleInner) * 0.25;
  const doubleEdge = (RADII.doubleOuter - RADII.doubleInner) * 0.25;
  const bands = [
    { radius: 0.30, kind: 'bed' },
    { radius: 0.45, kind: 'bed' },
    { radius: RADII.tripleInner + tripleEdge, kind: 'ring' },
    { radius: TRIPLE_MID, kind: 'ring' },
    { radius: RADII.tripleOuter - tripleEdge, kind: 'ring' },
    { radius: 0.72, kind: 'bed' },
    { radius: 0.88, kind: 'bed' },
    { radius: RADII.doubleInner + doubleEdge, kind: 'ring' },
    { radius: DOUBLE_MID, kind: 'ring' },
    { radius: RADII.doubleOuter - doubleEdge, kind: 'ring' }
  ];

  for (let sector = 0; sector < 20; sector++) {
    const dark = sector % 2 === 0; // on a steel-tip board bed 20 is black and its rings are red
    for (const band of bands) {
      for (const delta of [-5, 0, 5]) {
        const angle = ((sector * 18 + delta) * Math.PI) / 180;
        points.push({
          point: [band.radius * Math.sin(angle), -band.radius * Math.cos(angle)],
          expect: band.kind === 'ring' ? (dark ? 'red' : 'green') : (dark ? 'dark' : 'light')
        });
      }
    }
  }
  return points;
}

const CONTROL_POINTS = controlPoints();

/**
 * Scores the fit: how many control points have a colour that matches the board layout.
 * Brightness is thresholded at the median of the samples themselves, so the measure also works in poor light.
 * Beds with red rings are dark on every board seen so far, so the pattern is
 * the same whether bed 20 is black (steel-tip) or light (some soft-tip boards);
 * only the rotation differs by one bed.
 */
export function evaluateFit(image, boardToImage) {
  if (!boardToImage) return { score: 0, samples: 0 };

  const observed = [];
  const luma = [];
  for (const { point, expect } of CONTROL_POINTS) {
    const [x, y] = applyHomography(boardToImage, point);
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= image.width || py >= image.height) continue;
    const i = (py * image.width + px) * 4;
    const r = image.data[i];
    const g = image.data[i + 1];
    const b = image.data[i + 2];
    const color = classifyColor(r, g, b);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    observed.push({ expect, color, brightness });
    if (!color) luma.push(brightness);
  }
  if (observed.length < CONTROL_POINTS.length * 0.6) return { score: 0, samples: observed.length };

  luma.sort((a, b) => a - b);
  const threshold = luma.length ? luma[Math.floor(luma.length / 2)] : 128;

  let matched = 0;
  for (const sample of observed) {
    const actual = sample.color || (sample.brightness >= threshold ? 'light' : 'dark');
    if (actual === sample.expect) matched++;
  }
  // Points that fall outside the frame count as misses, so the fit cannot
  // improve its score by pushing the awkward part of the board off the image.
  return { score: matched / CONTROL_POINTS.length, samples: observed.length };
}

/**
 * Tunes the board pose parameters by pattern search: each parameter is
 * nudged both ways, and the steps shrink while the colour agreement
 * keeps improving.
 */
function refineFit(image, start) {
  const scale = (start.rx + start.ry) / 2;
  let params = { ...start };
  let best = evaluateFit(image, buildMatrix(params));

  const steps = {
    cx: scale * 0.02,
    cy: scale * 0.02,
    rx: scale * 0.02,
    ry: scale * 0.02,
    tilt: 0.03,
    ax: 0.03,
    ay: 0.03,
    spin: 1.2
  };

  for (let round = 0; round < 9; round++) {
    let improved = false;
    for (const key of Object.keys(steps)) {
      for (const direction of [1, -1]) {
        const candidate = { ...params, [key]: params[key] + steps[key] * direction };
        const matrix = buildMatrix(candidate);
        if (!matrix) continue;
        const result = evaluateFit(image, matrix);
        if (result.score > best.score) {
          params = candidate;
          best = result;
          improved = true;
        }
      }
    }
    if (!improved) {
      for (const key of Object.keys(steps)) steps[key] *= 0.5;
    }
  }

  return { params, score: best.score, samples: best.samples };
}

/**
 * Looks for the bull: a connected, compact blob of coloured pixels of roughly
 * the expected size, lying close to the board centre.
 * @returns {[number, number]|null} bull centre in image pixels
 */
function findBull(kind, width, height, affineInverse, expectedArea) {
  const visited = new Uint8Array(kind.length);
  const stack = [];
  let best = null;

  for (let start = 0; start < kind.length; start++) {
    if (!kind[start] || visited[start]) continue;

    visited[start] = 1;
    stack.push(start);
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;

    while (stack.length) {
      const p = stack.pop();
      const px = p % width;
      const py = (p - px) / width;
      count++;
      sumX += px;
      sumY += py;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (kind[q] && !visited[q]) {
            visited[q] = 1;
            stack.push(q);
          }
        }
      }
    }

    if (count < 4 || count < expectedArea * 0.15 || count > expectedArea * 5) continue;

    const cx = sumX / count;
    const cy = sumY / count;
    const [bx, by] = applyHomography(affineInverse, [cx, cy]);
    const distance = Math.hypot(bx, by);
    if (!Number.isFinite(distance) || distance > 0.35) continue;

    // The bull is a disc, the rings are long arcs; compactness filters them out.
    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    const elongation = Math.max(boxWidth, boxHeight) / Math.min(boxWidth, boxHeight);
    const fill = count / (boxWidth * boxHeight);
    if (elongation > 2.2 || fill < 0.45) continue;

    const score = fill / (1 + 4 * distance);
    if (!best || score > best.score) best = { score, point: [cx, cy] };
  }

  return best ? best.point : null;
}

/**
 * Fits the alternating red/green pattern of the doubles and trebles, which
 * fixes the rotation to within 36°: the returned angle puts a red-ringed bed
 * where bed 20 would be.
 */
function findPhase(base, image) {
  const RINGS = [DOUBLE_MID, TRIPLE_MID];
  const OFFSETS = [-6, -2, 2, 6];

  const scoreFor = (offset) => {
    let score = 0;
    let hits = 0;
    for (let sector = 0; sector < 20; sector++) {
      const expectRed = sector % 2 === 0;
      for (const radius of RINGS) {
        for (const delta of OFFSETS) {
          const angle = ((sector * 18 + offset + delta) * Math.PI) / 180;
          const point = [radius * Math.sin(angle), -radius * Math.cos(angle)];
          const [x, y] = applyHomography(base, point);
          const kind = classifyAt(image, x, y);
          if (!kind) continue;
          hits++;
          score += (kind === 'red') === expectRed ? 1 : -1;
        }
      }
    }
    return { score, hits };
  };

  // The colour pattern is a step function, so the best score holds over
  // a whole range of angles. We take the MIDDLE of that range, not its edge;
  // otherwise the calibration can be off by a few degrees, which at the board's
  // edge is already an error the size of a bed.
  const STEP = 0.25;
  const scores = [];
  for (let offset = 0; offset < 36; offset += STEP) scores.push({ offset, ...scoreFor(offset) });

  const top = scores.reduce((a, b) => (b.score > a.score ? b : a));
  if (top.hits < 40 || top.score < top.hits * 0.35) return null;

  const plateau = scores.filter((s) => s.score >= top.score - 1e-9).map((s) => s.offset);
  const meanAngle = Math.atan2(
    plateau.reduce((sum, o) => sum + Math.sin((o * 2 * Math.PI) / 36), 0) / plateau.length,
    plateau.reduce((sum, o) => sum + Math.cos((o * 2 * Math.PI) / 36), 0) / plateau.length
  );
  return ((meanAngle / (2 * Math.PI)) * 36 + 36) % 36;
}

/** Angle, in degrees, between "towards bed 20" and "up" in the frame. */
function tiltFromUp(unrotated, spin) {
  const map = multiply(unrotated, rotation(spin));
  const [ox, oy] = applyHomography(map, [0, 0]);
  const [tx, ty] = applyHomography(map, [0, -0.6]);
  return Math.abs((Math.atan2(tx - ox, -(ty - oy)) * 180) / Math.PI);
}

/**
 * Settles which bed is 20. The colour pattern leaves twenty candidates 18° apart:
 * on a steel-tip board bed 20 is black with red rings, on some soft-tip boards it
 * is light with green rings. Colour cannot tell the two apart, so the frame's
 * "up" decides, with the steel-tip layout preferred: it wins while bed 20 is
 * within 15° of the top, and the reversed layout only when it is within 3°.
 * (Reading the printed numbers was tried; on real boards logos and wire rings
 * made it wrong about as often as right.)
 */
function chooseNumbering(unrotated, patternSpin) {
  const nearest = (first) => {
    let best = null;
    for (let k = 0; k < 10; k++) {
      const spin = first + k * 36;
      const tilt = tiltFromUp(unrotated, spin);
      if (!best || tilt < best.tilt) best = { spin, tilt };
    }
    return best;
  };
  const standard = nearest(patternSpin);
  const reversed = nearest(patternSpin + 18);
  return reversed.tilt <= 3 && standard.tilt > 15 ? reversed.spin : standard.spin;
}
