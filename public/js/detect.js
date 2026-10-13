// Detects darts by comparing the frame with the remembered background.
//
// A dart is not one solid blob. In the image it shows up as several pieces:
// a bright barrel, a dark shaft (nearly invisible on a black bed) and bright flights,
// and in front of them a thin needle which, at the analysis resolution, is one
// or two pixels wide and barely stands out from the board. Hence two steps
// without which the result is simply wrong:
//
//   1. the pieces of one dart must be joined, or one throw is counted several times,
//   2. from the front of the barrel the needle must be traced at a MUCH lower threshold;
//      otherwise the hit lands where the thick part ends, not where
//      the dart actually went into the board.

/**
 * Pixel difference computed per colour channel, not on brightness alone.
 * A white dart on a sisal bed has almost the same brightness as the background;
 * only the blue channel gives it away. So we take the largest change among R, G and B.
 * `offset` removes a change shared by the whole frame (see measureDrift).
 */
const NO_OFFSET = [0, 0, 0];
const difference = (a, b, i, offset = NO_OFFSET) => Math.max(
  Math.abs(a[i] - b[i] - offset[0]),
  Math.abs(a[i + 1] - b[i + 1] - offset[1]),
  Math.abs(a[i + 2] - b[i + 2] - offset[2])
);

/**
 * How the whole frame differs from the background, apart from any dart: the
 * camera's auto-exposure and white balance drift, and sensor noise. A dart
 * covers a small part of the board, so the median change over the board is the
 * drift, and the median of what remains is the noise.
 */
export function measureDrift(reference, frame, mask) {
  const histograms = [new Uint32Array(511), new Uint32Array(511), new Uint32Array(511)];
  const samples = [];
  const total = frame.width * frame.height;
  for (let p = 0; p < total; p += 3) {
    if (mask && !mask[p]) continue;
    samples.push(p);
    const i = p * 4;
    for (let c = 0; c < 3; c++) histograms[c][frame.data[i + c] - reference.data[i + c] + 255]++;
  }
  if (samples.length < 50) return { offset: NO_OFFSET, noise: 0 };

  const median = (histogram, count) => {
    let seen = 0;
    for (let v = 0; v < histogram.length; v++) {
      seen += histogram[v];
      if (seen * 2 >= count) return v;
    }
    return 0;
  };
  const offset = histograms.map((h) => median(h, samples.length) - 255);

  const residual = new Uint32Array(256);
  for (const p of samples) residual[difference(frame.data, reference.data, p * 4, offset)]++;
  return { offset, noise: median(residual, samples.length) };
}

const DEFAULTS = {
  threshold: 30,        // threshold for the clearly visible parts of a dart
  traceThreshold: 11,   // threshold when tracing the needle along the dart's axis
  // A dart gives strong contrast in the frame. Video compression noise and
  // auto-exposure drift give weak, smeared changes, hence the requirement that
  // the blob contains a core of pixels that really differ from the background.
  strongThreshold: 55,
  minStrongPixels: 8,
  minElongation: 1.5,   // a dart is elongated; a round speck is not a dart
  compactLimit: 60,     // above this many pixels elongation is not required
  minPixels: 10,        // smallest meaningful piece
  minDartPixels: 20,    // smallest whole dart after joining
  maxPixels: Infinity,
  mergeDistance: 8,     // px: gap at which pieces are always joined
  collinearDistance: 26,// px: gap allowed when the pieces lie on one axis
  collinearCorridor: 4, // px: how far a piece may sit off its neighbour's axis
  maxTrace: 26,         // px: the farthest we look for the needle
  traceMisses: 5,       // this many pixels without a trace ends the search
  // When the needle is not visible at all (steel on bright sisal can give no
  // contrast whatsoever), the tip is extended geometrically: the protruding needle is about 15 %
  // of the dart's visible length. A fraction of the length scales with perspective by itself:
  // a dart pointing towards the camera gets shorter in the frame together with its needle.
  fallbackExtend: 0.15,
  bluntTip: 3,         // px: above this width the tip is no longer a needle
  // The pixel sizes above suit a board about 130 px in radius, as at the app's
  // analysis width with the board filling most of the frame. `scale` is the
  // board's actual radius over that, and resizes them.
  scale: 1
};

/**
 * Areas scale with the square of the board's size. Distances only grow: on a
 * small board a dart is not proportionally thinner at this resolution, and
 * shrinking the gaps allowed between its pieces would split it in two.
 */
function scaledConfig(config) {
  const s = Math.min(2.5, Math.max(0.4, config.scale || 1));
  if (s === 1) return config;
  const area = s * s;
  const grow = Math.max(1, s);
  return {
    ...config,
    minPixels: Math.max(4, Math.round(config.minPixels * area)),
    minDartPixels: Math.max(8, Math.round(config.minDartPixels * area)),
    minStrongPixels: Math.max(3, Math.round(config.minStrongPixels * area)),
    compactLimit: config.compactLimit * area,
    mergeDistance: config.mergeDistance * grow,
    collinearDistance: config.collinearDistance * grow,
    collinearCorridor: config.collinearCorridor * grow,
    maxTrace: config.maxTrace * grow,
    bluntTip: config.bluntTip * grow
  };
}

/** Number of pixels whose colour changed between two frames. */
export function changedPixels(a, b, { threshold = 30, mask = null } = {}) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return 0;
  let count = 0;
  for (let p = 0; p < a.width * a.height; p++) {
    if (mask && !mask[p]) continue;
    if (difference(a.data, b.data, p * 4) >= threshold) count++;
  }
  return count;
}

/** Connected regions of changed pixels (8-neighbourhood), each with its pixel list. */
function findComponents(reference, frame, { threshold, strongThreshold, minPixels, mask, offset }) {
  const { width, height } = frame;
  const changedMask = new Uint8Array(width * height);
  const strongMask = new Uint8Array(width * height);
  let changed = 0;

  for (let p = 0; p < width * height; p++) {
    if (mask && !mask[p]) continue;
    const value = difference(frame.data, reference.data, p * 4, offset);
    if (value < threshold) continue;
    changedMask[p] = 1;
    if (value >= strongThreshold) strongMask[p] = 1;
    changed++;
  }

  const visited = new Uint8Array(width * height);
  const stack = [];
  const components = [];

  for (let start = 0; start < changedMask.length; start++) {
    if (!changedMask[start] || visited[start]) continue;

    visited[start] = 1;
    stack.push(start);
    const pixels = [];
    let strong = 0;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;

    while (stack.length) {
      const p = stack.pop();
      const x = p % width;
      const y = (p - x) / width;
      pixels.push({ x, y });
      if (strongMask[p]) strong++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (changedMask[q] && !visited[q]) {
            visited[q] = 1;
            stack.push(q);
          }
        }
      }
    }

    if (pixels.length >= minPixels) components.push({ pixels, strong, minX, maxX, minY, maxY });
  }

  return { changed, components };
}

/** Distance between bounding boxes: a cheap first proximity test. */
function boxDistance(a, b) {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  return Math.hypot(dx, dy);
}

/** Smallest distance between the pixels of two pieces (sampling every third pixel). */
function pixelDistance(a, b, stopAt) {
  let best = Infinity;
  for (let i = 0; i < a.pixels.length; i += 3) {
    const p = a.pixels[i];
    for (let j = 0; j < b.pixels.length; j += 3) {
      const q = b.pixels[j];
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < best) best = d;
      if (best <= stopAt) return best;
    }
  }
  return best;
}

/** Distance of one piece's centre from the other piece's axis. */
function offAxisDistance(component, other) {
  const axis = axisOf(other.pixels);
  const dx = component.centroid.x - axis.mx;
  const dy = component.centroid.y - axis.my;
  return Math.abs(-dx * axis.uy + dy * axis.ux);
}

/**
 * Joins the pieces of one dart. Close pieces are always joined, distant ones
 * only when they share an axis, because the parts of one dart line up along it
 * and two separate darts side by side do not.
 */
function mergeComponents(components, config) {
  const parent = components.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));

  for (const component of components) {
    const n = component.pixels.length;
    component.centroid = {
      x: component.pixels.reduce((s, p) => s + p.x, 0) / n,
      y: component.pixels.reduce((s, p) => s + p.y, 0) / n
    };
  }

  for (let i = 0; i < components.length; i++) {
    for (let j = i + 1; j < components.length; j++) {
      if (find(i) === find(j)) continue;

      const limit = Math.max(config.mergeDistance, config.collinearDistance);
      if (boxDistance(components[i], components[j]) > limit) continue;

      const gap = pixelDistance(components[i], components[j], config.mergeDistance);
      let merge = gap <= config.mergeDistance;

      if (!merge && gap <= config.collinearDistance) {
        const bigger = components[i].pixels.length >= components[j].pixels.length ? i : j;
        const smaller = bigger === i ? j : i;
        merge = components[bigger].pixels.length >= config.minPixels + 2
          && offAxisDistance(components[smaller], components[bigger]) <= config.collinearCorridor;
      }

      if (merge) parent[find(i)] = find(j);
    }
  }

  const groups = new Map();
  components.forEach((component, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, { pixels: [], strong: 0 });
    const group = groups.get(root);
    group.pixels.push(...component.pixels);
    group.strong += component.strong;
  });
  return [...groups.values()];
}

/** The dart's axis and its two ends (principal component analysis). */
function axisOf(pixels) {
  const n = pixels.length;
  let mx = 0;
  let my = 0;
  for (const p of pixels) { mx += p.x; my += p.y; }
  mx /= n;
  my /= n;

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pixels) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  sxx /= n; sxy /= n; syy /= n;

  const trace = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const spread = Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
  const lambda = trace / 2 + spread;
  const smaller = Math.max(trace / 2 - spread, 1e-6);
  const elongation = Math.sqrt(lambda / smaller);

  let ux;
  let uy;
  if (Math.abs(sxy) > 1e-9) {
    ux = lambda - syy;
    uy = sxy;
  } else {
    ux = sxx >= syy ? 1 : 0;
    uy = sxx >= syy ? 0 : 1;
  }
  const length = Math.hypot(ux, uy) || 1;
  return { mx, my, ux: ux / length, uy: uy / length, elongation };
}

/**
 * Picks the end with the tip. The main cue: at the tip the dart is narrow
 * (needle, front of the barrel), at the flights it is wide. When both ends are
 * similarly wide, perspective decides: the flights are closer to the camera,
 * so they move further from the frame axis than the tip.
 */
function chooseTipEnd(pixels, axis, center) {
  const projected = pixels.map((p) => {
    const dx = p.x - axis.mx;
    const dy = p.y - axis.my;
    return {
      p,
      t: dx * axis.ux + dy * axis.uy,
      w: -dx * axis.uy + dy * axis.ux
    };
  }).sort((a, b) => a.t - b.t);

  const span = projected[projected.length - 1].t - projected[0].t;
  const cut = Math.max(2, span * 0.3);
  const lowEnd = projected.filter((q) => q.t <= projected[0].t + cut);
  const highEnd = projected.filter((q) => q.t >= projected[projected.length - 1].t - cut);

  const widthOf = (group) => {
    const values = group.map((q) => q.w);
    return Math.max(...values) - Math.min(...values);
  };
  const pointOf = (group, low) => {
    const sorted = [...group].sort((a, b) => (low ? a.t - b.t : b.t - a.t)).slice(0, 3);
    return {
      x: sorted.reduce((s, q) => s + q.p.x, 0) / sorted.length,
      y: sorted.reduce((s, q) => s + q.p.y, 0) / sorted.length
    };
  };

  const lowWidth = widthOf(lowEnd);
  const highWidth = widthOf(highEnd);
  const lowPoint = pointOf(lowEnd, true);
  const highPoint = pointOf(highEnd, false);

  // The width at the very tip later decides whether the needle is already in the blob
  // (thin tip) or the blob ends at the front of the barrel (blunt tip).
  const extremeWidth = (group, low) => {
    const edge = low
      ? Math.min(...group.map((q) => q.t))
      : Math.max(...group.map((q) => q.t));
    const near = group.filter((q) => Math.abs(q.t - edge) <= 2);
    return near.length ? widthOf(near) : 0;
  };
  const lowTipWidth = extremeWidth(lowEnd, true);
  const highTipWidth = extremeWidth(highEnd, false);

  const ratio = lowWidth / (highWidth || 1);
  let lowIsTip;
  if (ratio < 0.8) lowIsTip = true;
  else if (ratio > 1.25) lowIsTip = false;
  else {
    const lowDistance = Math.hypot(lowPoint.x - center.x, lowPoint.y - center.y);
    const highDistance = Math.hypot(highPoint.x - center.x, highPoint.y - center.y);
    lowIsTip = lowDistance <= highDistance;
  }

  return lowIsTip
    ? { tip: lowPoint, back: highPoint, span, tipWidth: lowTipWidth }
    : { tip: highPoint, back: lowPoint, span, tipWidth: highTipWidth };
}

/**
 * Traces the needle: walks on from the front of the dart along its axis and
 * checks whether the image still differs from the background, at a threshold low
 * enough to catch a single blurred pixel of steel on sisal.
 */
function traceNeedle(reference, frame, tip, direction, config, mask) {
  const { width, height } = frame;
  const sample = (x, y) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= width || py >= height) return -1;
    const p = py * width + px;
    if (mask && !mask[p]) return -1;
    return difference(frame.data, reference.data, p * 4, config.offset);
  };

  let best = { x: tip.x, y: tip.y };
  let misses = 0;
  let drift = 0; // the needle can sit slightly off the computed axis; we follow its trace

  for (let step = 0.6; step <= config.maxTrace; step += 0.6) {
    const x = tip.x + direction.x * step;
    const y = tip.y + direction.y * step;

    let strongest = -1;
    let strongestOffset = drift;
    for (const offset of [-2, -1.25, -0.6, 0, 0.6, 1.25, 2]) {
      const shifted = drift + offset;
      const value = sample(x - direction.y * shifted, y + direction.x * shifted);
      if (value > strongest) {
        strongest = value;
        strongestOffset = shifted;
      }
    }

    if (strongest >= config.traceThreshold) {
      drift = drift * 0.6 + strongestOffset * 0.4;
      best = { x: x - direction.y * drift, y: y + direction.x * drift };
      misses = 0;
    } else if (++misses >= config.traceMisses) {
      break;
    }
  }
  return best;
}

/**
 * Finds darts that have arrived on the board relative to the background frame.
 * @returns {{changed:number, darts:Array<{x:number,y:number,nx:number,ny:number,size:number,traced:number}>}}
 */
export function findDarts(reference, frame, options = {}) {
  const base = scaledConfig({ ...DEFAULTS, ...options });
  const empty = { changed: 0, darts: [] };
  if (!reference || !frame) return empty;
  if (reference.width !== frame.width || reference.height !== frame.height) return empty;

  // Thresholds rise with the noise, so that in dim light the needle trace does not
  // wander off into grain. `noise` is the median change per pixel; the trace takes
  // the strongest of several samples, so its threshold needs the widest margin
  // over it. The main thresholds already sit well above ordinary noise and move
  // only in a very grainy frame.
  const { offset, noise } = measureDrift(reference, frame, base.mask);
  const config = {
    ...base,
    offset,
    threshold: Math.max(base.threshold, noise * 2.5),
    strongThreshold: Math.max(base.strongThreshold, noise * 4),
    traceThreshold: Math.max(base.traceThreshold, noise * 1.8)
  };
  const { changed, components } = findComponents(reference, frame, config);
  if (!components.length) return { changed, darts: [] };

  const center = config.center || { x: frame.width / 2, y: frame.height / 2 };
  const darts = [];

  for (const { pixels, strong } of mergeComponents(components, config)) {
    if (pixels.length < config.minDartPixels || pixels.length > config.maxPixels) continue;

    // Without a core of strongly contrasting pixels this is image noise, not a dart.
    if (strong < config.minStrongPixels) continue;

    const axis = axisOf(pixels);
    // A dart is elongated. The requirement is relaxed for large blobs: a dart aimed
    // straight at the camera projects onto the frame as a compact blob.
    if (pixels.length < config.compactLimit && axis.elongation < config.minElongation) continue;
    const { tip, back, span, tipWidth } = chooseTipEnd(pixels, axis, center);

    // The direction comes from the dart's principal axis, not from the segment between its ends:
    // the wide end of the flights can skew that segment by a dozen-odd degrees,
    // and then the needle search misses the needle after just two pixels.
    const forward = (tip.x - back.x) * axis.ux + (tip.y - back.y) * axis.uy >= 0 ? 1 : -1;
    const direction = { x: axis.ux * forward, y: axis.uy * forward };

    let point = traceNeedle(reference, frame, tip, direction, config, config.mask);
    let traced = Math.hypot(point.x - tip.x, point.y - tip.y);
    let estimated = 0;

    // Extend only when the blob ends on something thick, i.e. the front of
    // the barrel. If the tip is thin, the needle is already in the blob and the tip is right.
    if (traced < 1.5 && tipWidth > config.bluntTip) {
      estimated = span * config.fallbackExtend;
      point = { x: tip.x + direction.x * estimated, y: tip.y + direction.y * estimated };
      traced = 0;
    }

    darts.push({
      x: point.x,
      y: point.y,
      nx: point.x / frame.width,
      ny: point.y / frame.height,
      size: pixels.length,
      traced,
      estimated
    });
  }

  darts.sort((a, b) => b.size - a.size);
  return { changed, darts };
}

/**
 * Mask of the pixels that lie on the board, computed once per calibration so
 * the homography is not recomputed for every pixel of every frame.
 */
export function buildBoardMask(imageToBoard, width, height, applyHomography, { margin = 1.3, scaleX = 1, scaleY = 1 } = {}) {
  const mask = new Uint8Array(width * height);
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [bx, by] = applyHomography(imageToBoard, [(x + 0.5) * scaleX, (y + 0.5) * scaleY]);
      if (Number.isFinite(bx) && Math.hypot(bx, by) <= margin) {
        mask[y * width + x] = 1;
        count++;
      }
    }
  }
  return { mask, count };
}
