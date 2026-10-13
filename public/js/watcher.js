// State machine watching the board: it recognises by itself when a dart has arrived.
//
// Frames arrive here a few times a second. Analysis only starts
// once the image is still: while a player, or a hand reaching for the darts,
// moves in the frame, comparing against the background would make no sense and give false hits.

import { changedPixels, findDarts } from './detect.js';

export const WATCH = {
  SETTLING: 'settling',   // waiting for the image to settle
  BASELINE: 'baseline',   // the clear background has been remembered
  MOTION: 'motion',       // movement in the frame
  OCCLUDED: 'occluded',   // someone is covering the board
  WATCHING: 'watching',   // still, nothing new on the board
  CONFIRMING: 'confirming', // something appeared; checking that it stays put
  DARTS: 'darts'          // new darts
};

const DEFAULTS = {
  threshold: 30,
  minPixels: 18,
  maxDartArea: 0.05,     // fraction of the board area; a bigger blob is not a dart
  motionLimit: 0.015,    // fraction of the board area changed between frames
  occlusionLimit: 0.20,  // above this the board is taken to be covered
  settleFrames: 2,       // this many still frames in a row before analysis
  confirmDistance: 4,    // how many pixels the tip may "twitch" between analyses (board 130 px in radius)
  confirmSightings: 3,   // how many times in a row a dart must stay in the same place
  // A still frame that stays "covered" this many analyses in a row is a lasting
  // change of the scene (a lamp switched on, the sun), not a player: it becomes
  // the new background. At the app's pace that is about four seconds.
  stuckOccluded: 18
};

/** Board radius, in pixels, that the detector's pixel sizes are tuned for. */
const REFERENCE_RADIUS = 130;
/** The board mask reaches this far beyond the double (see buildBoardMask). */
const MASK_MARGIN = 1.3;

export function createTracker(options = {}) {
  const config = { ...DEFAULTS, ...options };

  let mask = null;
  let area = 0;
  let reference = null;
  let previous = null;
  let pending = null;
  let calm = 0;
  let covered = 0;
  let scale = 1;

  const limits = () => ({
    motion: Math.max(12, area * config.motionLimit),
    occlusion: area * config.occlusionLimit,
    maxPixels: Math.max(config.minPixels * 4, area * config.maxDartArea)
  });

  return {
    /** Mask of the board's pixels; nothing outside it matters. */
    setBoardMask(newMask, count) {
      mask = newMask;
      area = count || (newMask ? newMask.length : 0);
      scale = Math.sqrt(area / Math.PI) / MASK_MARGIN / REFERENCE_RADIUS;
      reference = null;
      previous = null;
      pending = null;
      calm = 0;
      covered = 0;
    },

    /** Forgets the background; used after the darts are pulled. */
    reset() {
      reference = null;
      previous = null;
      pending = null;
      calm = 0;
      covered = 0;
    },

    hasBaseline() {
      return Boolean(reference);
    },

    /** Pushes the next frame and says what is happening in it. */
    push(frame) {
      if (!frame || !area) return { status: WATCH.SETTLING };

      if (!previous) {
        previous = frame;
        calm = 0;
        return { status: WATCH.SETTLING };
      }

      const { motion, occlusion, maxPixels } = limits();
      const movement = changedPixels(previous, frame, { threshold: config.threshold, mask });
      previous = frame;

      if (movement > motion) {
        calm = 0;
        pending = null;
        return { status: WATCH.MOTION, movement };
      }
      calm++;
      if (calm < config.settleFrames) return { status: WATCH.SETTLING, movement };

      if (!reference) {
        reference = frame;
        return { status: WATCH.BASELINE };
      }

      const { changed, darts: found } = findDarts(reference, frame, {
        threshold: config.threshold,
        minDartPixels: config.minPixels,
        maxPixels,
        mask,
        scale
      });

      if (changed > occlusion) {
        pending = null;
        if (++covered >= config.stuckOccluded) {
          covered = 0;
          reference = frame;
          return { status: WATCH.BASELINE };
        }
        return { status: WATCH.OCCLUDED, changed };
      }
      covered = 0;

      if (!found.length) {
        // Still and nothing new: take this frame as the background, so that slow changes
        // in light do not build up into a false detection.
        pending = null;
        reference = frame;
        return { status: WATCH.WATCHING, changed };
      }

      // A dart must stay in the same place over several consecutive analyses.
      // Otherwise we would count a dart caught in flight, a dart still shaking
      // after it lands, or a stray image compression artefact.
      // The reported tip is the average over the sightings, which steadies it
      // against the pixel or two it jitters between frames.
      const reach = Math.max(3, config.confirmDistance * scale);
      const matched = found.map((dart) => {
        const seen = pending
          ? pending.find((old) => Math.hypot(old.x - dart.x, old.y - dart.y) <= reach)
          : null;
        if (!seen) return { ...dart, sightings: 1, sumX: dart.x, sumY: dart.y };
        const sightings = seen.sightings + 1;
        const sumX = seen.sumX + dart.x;
        const sumY = seen.sumY + dart.y;
        const x = sumX / sightings;
        const y = sumY / sightings;
        return { ...dart, x, y, nx: x / frame.width, ny: y / frame.height, sightings, sumX, sumY };
      });

      const confirmed = matched.filter((dart) => dart.sightings >= config.confirmSightings);

      if (!confirmed.length) {
        pending = matched;
        return { status: WATCH.CONFIRMING, changed, sightings: Math.max(...matched.map((d) => d.sightings)) };
      }

      pending = null;
      reference = frame;
      return { status: WATCH.DARTS, darts: confirmed, changed };
    }
  };
}
