import test from 'node:test';
import assert from 'node:assert/strict';

import { findDarts, changedPixels } from '../public/js/detect.js';
import { drawRealisticDart, cloneImage } from './board-image.js';

const WIDTH = 200;
const HEIGHT = 200;
const CENTER = { x: WIDTH / 2, y: HEIGHT / 2 };

/** A flat dark background, like a black bed where a dart's dark shaft disappears. */
function background(gray = [40, 40, 44]) {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = gray[0];
    data[i + 1] = gray[1];
    data[i + 2] = gray[2];
    data[i + 3] = 255;
  }
  return { data, width: WIDTH, height: HEIGHT };
}

/** A dart stuck at the given point; flights leaning away from the frame axis, as in reality. */
function withDart(base, tipX, tipY, options) {
  const away = Math.hypot(tipX - CENTER.x, tipY - CENTER.y) || 1;
  return drawRealisticDart(
    cloneImage(base),
    tipX, tipY,
    (tipX - CENTER.x) / away,
    (tipY - CENTER.y) / away,
    options
  );
}

test('no change in the frame means no dart', () => {
  const clean = background();
  const { darts, changed } = findDarts(clean, cloneImage(clean));
  assert.equal(changed, 0);
  assert.equal(darts.length, 0);
});

test('a dart broken into pieces is still ONE throw', () => {
  // The dark shaft disappears on a dark bed, so the barrel and the flights are separate blobs.
  const clean = background();
  const frame = withDart(clean, 100, 40);

  const { darts } = findDarts(clean, frame, { center: CENTER });
  assert.equal(darts.length, 1, 'the pieces of one dart must be joined');
  assert.ok(darts[0].size > 100, `rozmiar ${darts[0].size}`);
});

test('the tip lands where the dart went into the board, not where the barrel ends', () => {
  const clean = background();
  const tipX = 100;
  const tipY = 40;
  const frame = withDart(clean, tipX, tipY);

  const { darts } = findDarts(clean, frame, { center: CENTER });
  assert.equal(darts.length, 1);

  const error = Math.hypot(darts[0].x - tipX, darts[0].y - tipY);
  assert.ok(error < 3, `tip found ${error.toFixed(1)} px from the entry point`);
  assert.ok(darts[0].traced > 4, `the needle should have been traced, traced ${darts[0].traced.toFixed(1)} px`);
});

test('without tracing the needle the error would be many times larger', () => {
  const clean = background();
  const frame = withDart(clean, 100, 40);

  const withTrace = findDarts(clean, frame, { center: CENTER }).darts[0];
  const withoutTrace = findDarts(clean, frame, { center: CENTER, maxTrace: 0 }).darts[0];

  const errorWith = Math.hypot(withTrace.x - 100, withTrace.y - 40);
  const errorWithout = Math.hypot(withoutTrace.x - 100, withoutTrace.y - 40);
  assert.ok(errorWithout > errorWith * 3,
    `without tracing ${errorWithout.toFixed(1)} px, with tracing ${errorWith.toFixed(1)} px`);
});

test('two darts in different places are two throws', () => {
  const clean = background();
  let frame = withDart(clean, 70, 60);
  frame = withDart(frame, 140, 70);

  const { darts } = findDarts(clean, frame, { center: CENTER });
  assert.equal(darts.length, 2);
});

test('a large change in the frame (occlusion) is not a dart', () => {
  const clean = background();
  const frame = cloneImage(clean);
  for (let y = 30; y < 170; y++) {
    for (let x = 30; x < 170; x++) {
      const i = (y * WIDTH + x) * 4;
      frame.data[i] = 210;
      frame.data[i + 1] = 170;
      frame.data[i + 2] = 150;
    }
  }
  const { darts } = findDarts(clean, frame, { center: CENTER, maxPixels: 2000 });
  assert.equal(darts.length, 0);
});

test('changes outside the board mask are ignored', () => {
  const clean = background();
  const frame = withDart(clean, 100, 40);

  const mask = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 120; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) mask[y * WIDTH + x] = 1;

  const { darts } = findDarts(clean, frame, { center: CENTER, mask });
  assert.equal(darts.length, 0);
});

test('too small a colour difference raises no false alarm', () => {
  const clean = background();
  const frame = cloneImage(clean);
  for (let y = 60; y < 80; y++) {
    for (let x = 60; x < 80; x++) {
      const i = (y * WIDTH + x) * 4;
      frame.data[i] += 6;
      frame.data[i + 1] += 6;
      frame.data[i + 2] += 6;
    }
  }
  assert.equal(findDarts(clean, frame, { center: CENTER }).darts.length, 0);
  assert.equal(changedPixels(clean, frame), 0);
});

test('the changed-pixel counter respects the threshold and the mask', () => {
  const clean = background();
  const frame = withDart(clean, 100, 40);
  assert.ok(changedPixels(clean, frame) > 50);

  const emptyMask = new Uint8Array(WIDTH * HEIGHT);
  assert.equal(changedPixels(clean, frame, { mask: emptyMask }), 0);
});

test('when the needle is not visible at all, the tip is extended geometrically', () => {
  // A steel needle on bright sisal can give no contrast at all.
  const clean = background([226, 211, 171]);
  const frame = withDart(clean, 100, 40, { needleContrast: 0.06 });

  const { darts } = findDarts(clean, frame, { center: CENTER });
  assert.equal(darts.length, 1);
  assert.equal(darts[0].traced, 0, 'the needle could not be spotted');
  assert.ok(darts[0].estimated > 3, `the tip should have been extended, extended ${darts[0].estimated}`);

  const error = Math.hypot(darts[0].x - 100, darts[0].y - 40);
  assert.ok(error < 4, `error ${error.toFixed(1)} px despite the invisible needle`);
});

test('the tracing direction comes from the dart axis, not from the segment between its ends', () => {
  // Wide flights skew the segment between the extreme pixels; if they
  // set the direction, the path would miss the needle after just two pixels.
  const clean = background();
  const frame = withDart(clean, 60, 60);

  const { darts } = findDarts(clean, frame, { center: CENTER });
  assert.equal(darts.length, 1);
  assert.ok(darts[0].traced > 4, `doszukano ${darts[0].traced.toFixed(1)} px`);
  assert.ok(Math.hypot(darts[0].x - 60, darts[0].y - 60) < 3);
});

test('pieces lying on one axis are joined even across a larger gap', () => {
  const clean = background();
  const frame = cloneImage(clean);
  const bar = (fromY, toY, halfWidth) => {
    for (let y = fromY; y <= toY; y++) {
      for (let x = 100 - halfWidth; x <= 100 + halfWidth; x++) {
        const i = (y * WIDTH + x) * 4;
        frame.data[i] = 220; frame.data[i + 1] = 220; frame.data[i + 2] = 225;
      }
    }
  };
  bar(40, 52, 2);   // barrel
  bar(70, 86, 4);   // flights, 18 px further along the same axis

  const { darts } = findDarts(clean, frame, { center: CENTER });
  assert.equal(darts.length, 1, 'this is one dart with an invisible shaft');
});

test('two darts side by side are not joined, despite a similar gap', () => {
  const clean = background();
  const frame = cloneImage(clean);
  const bar = (cx, fromY, toY, halfWidth) => {
    for (let y = fromY; y <= toY; y++) {
      for (let x = cx - halfWidth; x <= cx + halfWidth; x++) {
        const i = (y * WIDTH + x) * 4;
        frame.data[i] = 220; frame.data[i + 1] = 220; frame.data[i + 2] = 225;
      }
    }
  };
  bar(80, 40, 60, 3);   // dart A
  bar(100, 40, 60, 3);  // dart B, 17 px to the side: next to it, not on its axis

  const { darts } = findDarts(clean, frame, { center: CENTER });
  assert.equal(darts.length, 2, 'neighbouring darts are two throws');
});

test('a weak, smeared change without a strong core is not a dart', () => {
  // This is what flickering light or a shadow looks like: a change above the threshold, but without
  // pixels that really contrast with the background.
  const clean = background();
  const frame = cloneImage(clean);
  for (let y = 60; y < 110; y++) {
    for (let x = 96; x < 104; x++) {
      const i = (y * WIDTH + x) * 4;
      frame.data[i] += 40; frame.data[i + 1] += 40; frame.data[i + 2] += 40;
    }
  }
  const { changed, darts } = findDarts(clean, frame, { center: CENTER });
  assert.ok(changed > 200, 'the change is visible to the threshold');
  assert.equal(darts.length, 0, 'but it has no strong core, so it is not a dart');
});

/** Adds the same change to every pixel, as auto-exposure does between frames. */
function shifted(image, [dr, dg, db]) {
  const out = cloneImage(image);
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] += dr;
    out.data[i + 1] += dg;
    out.data[i + 2] += db;
  }
  return out;
}

/** Adds sensor noise, deterministically. */
function noisy(image, amplitude, seed) {
  const out = cloneImage(image);
  let state = seed;
  const rand = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff - 0.5;
  };
  for (let i = 0; i < out.data.length; i += 4) {
    for (let c = 0; c < 3; c++) out.data[i + c] += rand() * 2 * amplitude;
  }
  return out;
}

test('a change of exposure across the whole frame is neither a dart nor an occlusion', () => {
  const clean = background([120, 110, 90]);
  const brighter = shifted(clean, [34, 30, 26]);
  const { changed, darts } = findDarts(clean, brighter, { center: CENTER });
  assert.equal(darts.length, 0);
  assert.equal(changed, 0, 'the shared change is taken out before comparing');
});

test('a dart is still located after the exposure has drifted', () => {
  const clean = background();
  const frame = shifted(withDart(clean, 100, 40), [30, 30, 30]);
  const { darts } = findDarts(clean, frame, { center: CENTER });
  assert.equal(darts.length, 1);
  assert.ok(Math.hypot(darts[0].x - 100, darts[0].y - 40) < 3, `error ${Math.hypot(darts[0].x - 100, darts[0].y - 40).toFixed(1)} px`);
});

test('in a noisy frame the needle trace does not run off into the grain', () => {
  const clean = background([226, 211, 171]);
  const reference = noisy(clean, 9, 3);
  const frame = noisy(withDart(clean, 100, 40), 9, 11);
  const { darts } = findDarts(reference, frame, { center: CENTER });
  assert.equal(darts.length, 1);
  const error = Math.hypot(darts[0].x - 100, darts[0].y - 40);
  assert.ok(error < 4, `tip found ${error.toFixed(1)} px from the entry point`);
});

test('pixel sizes follow the size of the board in the frame', () => {
  // Half the usual board size: the dart is half as long, and its pieces sit closer.
  const clean = background();
  const frame = drawRealisticDart(cloneImage(clean), 100, 60, 0, -1, { scale: 0.5 });

  const { darts } = findDarts(clean, frame, { center: CENTER, scale: 0.5 });
  assert.equal(darts.length, 1);
  assert.ok(Math.hypot(darts[0].x - 100, darts[0].y - 60) < 3, `error ${Math.hypot(darts[0].x - 100, darts[0].y - 60).toFixed(1)} px`);
});

test('a round speck is not a dart', () => {
  const clean = background();
  const frame = cloneImage(clean);
  for (let y = 90; y < 97; y++) {
    for (let x = 90; x < 97; x++) {
      const i = (y * WIDTH + x) * 4;
      frame.data[i] = 240; frame.data[i + 1] = 240; frame.data[i + 2] = 245;
    }
  }
  assert.equal(findDarts(clean, frame, { center: CENTER }).darts.length, 0, 'a dart is elongated');
});
