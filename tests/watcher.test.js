import test from 'node:test';
import assert from 'node:assert/strict';

import { createTracker, WATCH } from '../public/js/watcher.js';
import { buildBoardMask } from '../public/js/detect.js';
import { detectBoard } from '../public/js/autocalib.js';
import { solveHomography, applyHomography, scoreAtImage } from '../public/js/geometry.js';
import { renderBoard, drawRealisticDart, cloneImage } from './board-image.js';

const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const TRUTH = solveHomography(corners, corners.map(([x, y]) => [240 + 130 * x, 180 + 130 * y]));

function boardPoint(angleDeg, radius) {
  const a = (angleDeg * Math.PI) / 180;
  return [radius * Math.sin(a), -radius * Math.cos(a)];
}

/** Sets the scene: a clear board, calibration and mask. */
function setup() {
  const clean = renderBoard(TRUTH);
  const calibration = detectBoard(clean);
  assert.ok(!calibration.error, calibration.error);

  const { mask, count } = buildBoardMask(calibration.imageToBoard, clean.width, clean.height, applyHomography);
  const tracker = createTracker();
  tracker.setBoardMask(mask, count);
  return { clean, calibration, tracker };
}

/** Draws a dart stuck in the given bed; flights leaning away from the frame axis, as in reality. */
function frameWithDart(base, angleDeg, radius, calibration) {
  const [tipX, tipY] = applyHomography(calibration.boardToImage, boardPoint(angleDeg, radius));
  const away = Math.hypot(tipX - base.width / 2, tipY - base.height / 2) || 1;
  return drawRealisticDart(
    cloneImage(base),
    tipX, tipY,
    (tipX - base.width / 2) / away,
    (tipY - base.height / 2) / away,
    { scale: 0.8 }
  );
}

test('first learns the background, then watches', () => {
  const { clean, tracker } = setup();
  assert.equal(tracker.push(clean).status, WATCH.SETTLING);
  assert.equal(tracker.push(clean).status, WATCH.SETTLING);
  assert.equal(tracker.push(clean).status, WATCH.BASELINE);
  assert.equal(tracker.push(clean).status, WATCH.WATCHING);
  assert.ok(tracker.hasBaseline());
});

test('a dart that lands is detected on its own, without any tap', () => {
  const { clean, calibration, tracker } = setup();
  for (let i = 0; i < 3; i++) tracker.push(clean);

  const withDart = frameWithDart(clean, 0, 0.6, calibration);
  assert.equal(tracker.push(withDart).status, WATCH.CONFIRMING, 'first we check it is not a dart in flight');
  assert.equal(tracker.push(withDart).status, WATCH.CONFIRMING, 'a shaking dart does not count yet either');
  const result = tracker.push(withDart);

  assert.equal(result.status, WATCH.DARTS);
  assert.equal(result.darts.length, 1);
  const score = scoreAtImage(calibration, result.darts[0].x, result.darts[0].y);
  assert.equal(score.label, 'T20');
});

test('further darts are counted separately, and a counted one stops being new', () => {
  const { clean, calibration, tracker } = setup();
  for (let i = 0; i < 3; i++) tracker.push(clean);

  const labels = [];
  let board = clean;
  for (const [angle, radius] of [[0, 0.6], [90, 0.45], [180, 0.98]]) {
    board = frameWithDart(board, angle, radius, calibration);
    tracker.push(board);
    tracker.push(board);
    const result = tracker.push(board);
    assert.equal(result.status, WATCH.DARTS, `lotka ${labels.length + 1}`);
    assert.equal(result.darts.length, 1, 'earlier darts already belong to the background');
    labels.push(scoreAtImage(calibration, result.darts[0].x, result.darts[0].y).label);
  }

  assert.deepEqual(labels, ['T20', '6', 'D3']);
});

test('two darts thrown while the board was covered are both counted', () => {
  const { clean, calibration, tracker } = setup();
  for (let i = 0; i < 3; i++) tracker.push(clean);

  let board = frameWithDart(clean, 0, 0.6, calibration);
  board = frameWithDart(board, 90, 0.45, calibration);
  tracker.push(board);
  tracker.push(board);
  const result = tracker.push(board);

  assert.equal(result.status, WATCH.DARTS);
  assert.equal(result.darts.length, 2);
  const labels = result.darts.map((d) => scoreAtImage(calibration, d.x, d.y).label).sort();
  assert.deepEqual(labels, ['6', 'T20']);
});

test('a player covering the board is not counted as a dart', () => {
  const { clean, tracker } = setup();
  for (let i = 0; i < 3; i++) tracker.push(clean);

  const blocked = cloneImage(clean);
  for (let y = 60; y < 300; y++) {
    for (let x = 150; x < 330; x++) {
      const i = (y * blocked.width + x) * 4;
      blocked.data[i] = 210;
      blocked.data[i + 1] = 170;
      blocked.data[i + 2] = 150;
    }
  }

  assert.equal(tracker.push(blocked).status, WATCH.MOTION, 'stepping into the frame is movement');
  assert.equal(tracker.push(blocked).status, WATCH.SETTLING);
  assert.equal(tracker.push(blocked).status, WATCH.OCCLUDED);
});

test('movement between frames pauses counting', () => {
  const { clean, tracker } = setup();
  for (let i = 0; i < 3; i++) tracker.push(clean);

  const moving = renderBoard(TRUTH, { noise: 160, seed: 99 });
  assert.equal(tracker.push(moving).status, WATCH.MOTION);
});

test('after the darts are pulled, a reset starts learning the background again', () => {
  const { clean, calibration, tracker } = setup();
  for (let i = 0; i < 3; i++) tracker.push(clean);
  const withDart = frameWithDart(clean, 0, 0.6, calibration);
  tracker.push(withDart);
  tracker.push(withDart);
  tracker.push(withDart);

  tracker.reset();
  assert.equal(tracker.hasBaseline(), false);
  assert.equal(tracker.push(clean).status, WATCH.SETTLING);
  assert.equal(tracker.push(clean).status, WATCH.SETTLING);
  assert.equal(tracker.push(clean).status, WATCH.BASELINE, 'the clear board becomes the new background');
  assert.equal(tracker.push(clean).status, WATCH.WATCHING, 'pulled darts are not counted as hits');
});

test('a lasting change of light does not leave the board "covered" for good', () => {
  const { clean, tracker } = setup();
  for (let i = 0; i < 3; i++) tracker.push(clean);

  // A lamp lights the left half of the board: more than the occlusion limit changes, and stays so.
  const lit = cloneImage(clean);
  for (let y = 0; y < lit.height; y++) {
    for (let x = 0; x < 240; x++) {
      const i = (y * lit.width + x) * 4;
      for (let c = 0; c < 3; c++) lit.data[i + c] += 70;
    }
  }

  const statuses = [];
  for (let i = 0; i < 25; i++) statuses.push(tracker.push(lit).status);
  assert.ok(statuses.includes(WATCH.OCCLUDED), 'at first it looks like a covered board');
  assert.ok(statuses.includes(WATCH.BASELINE), 'after a while the lit board becomes the background');
  assert.equal(statuses[statuses.length - 1], WATCH.WATCHING);
});

test('a dart shaking after it lands is not counted a second time', () => {
  const { clean, calibration, tracker } = setup();
  for (let i = 0; i < 3; i++) tracker.push(clean);

  // The dart comes to rest and is counted.
  const settled = frameWithDart(clean, 0, 0.6, calibration);
  tracker.push(settled);
  tracker.push(settled);
  assert.equal(tracker.push(settled).status, WATCH.DARTS);

  // Now it shakes: it appears and disappears in a slightly different place.
  const wobble = frameWithDart(clean, 1.5, 0.62, calibration);
  const statuses = [
    tracker.push(wobble).status,
    tracker.push(settled).status,
    tracker.push(wobble).status
  ];
  assert.ok(!statuses.includes(WATCH.DARTS), `shaking counted as a throw: ${statuses.join(', ')}`);
});
