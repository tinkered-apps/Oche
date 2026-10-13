import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SEGMENTS,
  RADII,
  segmentAt,
  scoreAtBoard,
  solveHomography,
  applyHomography,
  invert,
  scoreAtImage,
  alternativesFor,
  scoreFor
} from '../public/js/geometry.js';

/** Calibration from four known board points mapped through `project`. */
function calibrationFrom(project) {
  const board = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const boardToImage = solveHomography(board, board.map(project));
  return boardToImage ? { boardToImage, imageToBoard: invert(boardToImage) } : null;
}

/** A board point: angle in degrees from the top, clockwise. */
function boardPoint(angleDeg, radius) {
  const a = (angleDeg * Math.PI) / 180;
  return [radius * Math.sin(a), -radius * Math.cos(a)];
}

test('sectors on the main directions match a real board', () => {
  assert.equal(segmentAt(0, -1), 20); // top
  assert.equal(segmentAt(1, 0), 6);   // right
  assert.equal(segmentAt(0, 1), 3);   // bottom
  assert.equal(segmentAt(-1, 0), 11); // left
});

test('each of the 20 sectors hit in its centre', () => {
  SEGMENTS.forEach((sector, i) => {
    const [x, y] = boardPoint(i * 18, 0.8);
    assert.equal(segmentAt(x, y), sector, `sektor ${sector}`);
  });
});

test('sector boundaries fall halfway between numbers', () => {
  const [xa, ya] = boardPoint(8.5, 0.8);
  const [xb, yb] = boardPoint(9.5, 0.8);
  assert.equal(segmentAt(xa, ya), 20);
  assert.equal(segmentAt(xb, yb), 1);
});

test('rings are scored correctly', () => {
  assert.equal(scoreAtBoard(0, 0).points, 50);
  assert.equal(scoreAtBoard(0, 0).label, 'BULL');

  const outerBull = scoreAtBoard(0, -(RADII.innerBull + RADII.outerBull) / 2);
  assert.equal(outerBull.points, 25);

  const single = scoreAtBoard(...boardPoint(0, 0.4));
  assert.equal(single.points, 20);
  assert.equal(single.ring, 'single');

  const triple = scoreAtBoard(...boardPoint(0, (RADII.tripleInner + RADII.tripleOuter) / 2));
  assert.equal(triple.points, 60);
  assert.equal(triple.label, 'T20');

  const outerSingle = scoreAtBoard(...boardPoint(0, 0.8));
  assert.equal(outerSingle.points, 20);

  const double = scoreAtBoard(...boardPoint(0, (RADII.doubleInner + 1) / 2));
  assert.equal(double.points, 40);
  assert.equal(double.label, 'D20');

  const out = scoreAtBoard(...boardPoint(0, 1.05));
  assert.equal(out.points, 0);
  assert.equal(out.ring, 'out');
});

test('triple 19 and double 3 (lower part of the board)', () => {
  const t19 = scoreAtBoard(...boardPoint(11 * 18, 0.6));
  assert.equal(t19.label, 'T19');
  const d3 = scoreAtBoard(...boardPoint(10 * 18, 0.98));
  assert.equal(d3.label, 'D3');
});

test('the homography reproduces the given point transform', () => {
  const src = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const dst = [[10, 20], [110, 25], [120, 130], [5, 120]];
  const h = solveHomography(src, dst);
  assert.ok(h);
  src.forEach((p, i) => {
    const [x, y] = applyHomography(h, p);
    assert.ok(Math.abs(x - dst[i][0]) < 1e-6 && Math.abs(y - dst[i][1]) < 1e-6);
  });
});

test('calibration from a rotated and shifted board gives correct points', () => {
  // Simulated camera: the board in the image as a circle of radius 400 px,
  // centre (960, 540), rotated by 25 degrees.
  const cx = 960;
  const cy = 540;
  const scale = 400;
  const angle = (25 * Math.PI) / 180;
  const project = ([bx, by]) => [
    cx + scale * (bx * Math.cos(angle) - by * Math.sin(angle)),
    cy + scale * (bx * Math.sin(angle) + by * Math.cos(angle))
  ];

  const calibration = calibrationFrom(project);
  assert.ok(calibration);

  const cases = [
    { board: boardPoint(0, 0.6), label: 'T20' },
    { board: boardPoint(0, 0.98), label: 'D20' },
    { board: boardPoint(18, 0.45), label: '1' },
    { board: [0, 0], label: 'BULL' },
    { board: boardPoint(90, 0.6), label: 'T6' },
    { board: boardPoint(180, 0.98), label: 'D3' }
  ];

  for (const c of cases) {
    const [px, py] = project(c.board);
    assert.equal(scoreAtImage(calibration, px, py).label, c.label);
  }
});

test('calibration also works at an angle (perspective)', () => {
  // Perspective projection: the board seen from the side and above.
  const h = [420, 30, 900, -25, 380, 520, 0.00022, -0.00015, 1];
  const project = (p) => applyHomography(h, p);

  const calibration = calibrationFrom(project);
  assert.ok(calibration);

  const cases = [
    { board: boardPoint(0, 0.6), label: 'T20' },
    { board: boardPoint(54, 0.98), label: 'D4' },
    { board: boardPoint(198, 0.5), label: '19' },
    { board: [0, 0], label: 'BULL' },
    { board: boardPoint(270, 0.6), label: 'T11' }
  ];

  for (const c of cases) {
    const [px, py] = project(c.board);
    assert.equal(scoreAtImage(calibration, px, py).label, c.label);
  }
});

test('four collinear points give no homography', () => {
  const degenerate = [[0, 0], [10, 10], [20, 20], [30, 30]];
  assert.equal(solveHomography(degenerate, [[0, -1], [1, 0], [0, 1], [-1, 0]]), null);
});

test('a hit in the middle of a large bed is certain, next to a wire uncertain', () => {
  const middleOfBed = scoreAtBoard(...boardPoint(0, 0.4));
  assert.equal(middleOfBed.label, '20');
  assert.equal(middleOfBed.uncertain, false);

  const middleOfTriple = scoreAtBoard(...boardPoint(0, (RADII.tripleInner + RADII.tripleOuter) / 2));
  assert.equal(middleOfTriple.label, 'T20');
  assert.equal(middleOfTriple.uncertain, false, 'the middle of a ring is still a certain hit');

  const atTripleEdge = scoreAtBoard(...boardPoint(0, RADII.tripleInner + 0.004));
  assert.equal(atTripleEdge.label, 'T20');
  assert.equal(atTripleEdge.uncertain, true, 'just past the edge of the triple');

  const nearWire = scoreAtBoard(...boardPoint(8.5, 0.8));
  assert.equal(nearWire.label, '20');
  assert.equal(nearWire.uncertain, true, 'right next to the wire between beds');
});

test('the margin measures the distance to the nearest boundary', () => {
  const outerEdge = scoreAtBoard(...boardPoint(0, 0.995));
  assert.ok(outerEdge.margin < 0.006, `margines ${outerEdge.margin}`);
  // Near the board centre the beds are narrow, so the angle decides the boundary:
  // at r = 0.3 the wire is 9° away, i.e. 0.047 of the radius.
  const deepInside = scoreAtBoard(...boardPoint(0, 0.3));
  assert.ok(deepInside.margin > 0.04, `margines ${deepInside.margin}`);
  const wideBed = scoreAtBoard(...boardPoint(0, 0.85));
  assert.ok(wideBed.margin > 0.06, `margines ${wideBed.margin}`);
});

test('fix suggestions start with the most often confused beds', () => {
  const t20 = scoreAtBoard(...boardPoint(0, 0.6));
  const labels = alternativesFor(t20).map((c) => c.label);

  assert.deepEqual(labels.slice(0, 2), ['20', 'D20'], 'first the same number in another ring');
  assert.ok(labels.includes('T5') && labels.includes('T1'), 'then the neighbouring beds');
  assert.ok(labels.includes('MISS'));
  assert.ok(!labels.includes('T20'), 'the current bed is not a suggestion');

  const bull = alternativesFor(scoreAtBoard(0, 0)).map((c) => c.label);
  assert.ok(bull.includes('25'), 'at the bull the confusion is with the 25 ring');
});

test('a bed can be built from a number and a ring', () => {
  assert.equal(scoreFor(19, 'triple').points, 57);
  assert.equal(scoreFor(16, 'double').label, 'D16');
  assert.equal(scoreFor(0, 'out').points, 0);
  assert.equal(scoreFor(50, 'bull').label, 'BULL');
});
