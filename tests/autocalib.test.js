import test from 'node:test';
import assert from 'node:assert/strict';

import { detectBoard, classifyColor, fitEllipse } from '../public/js/autocalib.js';
import { solveHomography, applyHomography, scoreAtImage, RADII } from '../public/js/geometry.js';
import { renderBoard } from './board-image.js';

/** Homography "the camera looks at the board from the side and above": an ordinary perspective quadrilateral. */
function cameraView({ skewX = 0, skewY = 0, cx = 240, cy = 180, scale = 130 } = {}) {
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const image = corners.map(([x, y]) => {
    const depth = 1 + skewX * x + skewY * y;      // the further away, the smaller
    return [cx + (scale * x) / depth, cy + (scale * y) / depth];
  });
  return solveHomography(corners, image);
}

function boardPoint(angleDeg, radius) {
  const a = (angleDeg * Math.PI) / 180;
  return [radius * Math.sin(a), -radius * Math.cos(a)];
}

/** Largest mapping error in board units (1.0 = radius). */
function mappingError(truth, calibration) {
  let worst = 0;
  for (let angle = 0; angle < 360; angle += 15) {
    for (const radius of [0.1, 0.35, 0.6, 0.85, 0.99]) {
      const p = boardPoint(angle, radius);
      const [ix, iy] = applyHomography(truth, p);
      const [bx, by] = applyHomography(calibration.imageToBoard, [ix, iy]);
      worst = Math.max(worst, Math.hypot(bx - p[0], by - p[1]));
    }
  }
  return worst;
}

test('bed colours are recognised and the background rejected', () => {
  assert.equal(classifyColor(186, 42, 38), 'red');
  assert.equal(classifyColor(38, 120, 58), 'green');
  assert.equal(classifyColor(226, 211, 171), null, 'sizal');
  assert.equal(classifyColor(28, 28, 32), null, 'black bed');
  assert.equal(classifyColor(120, 118, 112), null, 'wall');
  assert.equal(classifyColor(205, 155, 125), null, 'skin tone');
});

test('ellipse fitting recovers known parameters', () => {
  const points = [];
  for (let i = 0; i < 60; i++) {
    const t = (i / 60) * 2 * Math.PI;
    const x = 90 * Math.cos(t);
    const y = 55 * Math.sin(t);
    const cos = Math.cos(0.4);
    const sin = Math.sin(0.4);
    points.push([200 + x * cos - y * sin, 150 + x * sin + y * cos]);
  }
  const fit = fitEllipse(points, [200, 150], 90);
  assert.ok(fit);
  assert.ok(Math.abs(fit.cx - 200) < 0.5 && Math.abs(fit.cy - 150) < 0.5);
  const axes = [fit.rx, fit.ry].sort((a, b) => b - a);
  assert.ok(Math.abs(axes[0] - 90) < 1, `semi-major axis ${axes[0]}`);
  assert.ok(Math.abs(axes[1] - 55) < 1, `semi-minor axis ${axes[1]}`);
});

test('board face-on: recognised to better than the width of a ring', () => {
  const truth = cameraView();
  const image = renderBoard(truth);
  const result = detectBoard(image);

  assert.ok(!result.error, result.error);
  const error = mappingError(truth, result);
  assert.ok(error < 0.02, `mapping error ${error.toFixed(4)}`);
  assert.ok(result.quality.match > 0.9, `colour pattern match ${result.quality.match}`);
});

test('board at an angle: perspective recovered from the bull offset', () => {
  const truth = cameraView({ skewX: 0.28, skewY: 0.14, scale: 120 });
  const image = renderBoard(truth);
  const result = detectBoard(image);

  assert.ok(!result.error, result.error);
  const error = mappingError(truth, result);
  assert.ok(error < 0.03, `mapping error ${error.toFixed(4)}`);
  assert.ok(result.quality.perspectiveShift > 0.02, 'the bull offset should be detected');
});

test('beds are recognised correctly after automatic calibration', () => {
  const truth = cameraView({ skewX: 0.2, skewY: -0.1 });
  const image = renderBoard(truth);
  const result = detectBoard(image);
  assert.ok(!result.error, result.error);

  const cases = [
    { angle: 0, radius: (RADII.tripleInner + RADII.tripleOuter) / 2, expect: 'T20' },
    { angle: 0, radius: (RADII.doubleInner + 1) / 2, expect: 'D20' },
    { angle: 18, radius: 0.4, expect: '1' },
    { angle: 90, radius: (RADII.tripleInner + RADII.tripleOuter) / 2, expect: 'T6' },
    { angle: 180, radius: (RADII.doubleInner + 1) / 2, expect: 'D3' },
    { angle: 270, radius: 0.4, expect: '11' },
    { angle: 342, radius: 0.8, expect: '5' },
    { angle: 0, radius: 0.0, expect: 'BULL' }
  ];

  for (const c of cases) {
    const [ix, iy] = applyHomography(truth, boardPoint(c.angle, c.radius));
    assert.equal(scoreAtImage(result, ix, iy).label, c.expect, `angle ${c.angle}°`);
  }
});

test('a rotated board (20 not exactly at the top) is still recognised', () => {
  for (const spin of [-12, -5, 7, 14]) {
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const a = (spin * Math.PI) / 180;
    const rotated = corners.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
    const truth = solveHomography(corners, rotated.map(([x, y]) => [240 + 130 * x, 180 + 130 * y]));

    const result = detectBoard(renderBoard(truth));
    assert.ok(!result.error, `${spin}°: ${result.error}`);

    const [ix, iy] = applyHomography(truth, boardPoint(0, 0.6));
    assert.equal(scoreAtImage(result, ix, iy).label, 'T20', `rotation ${spin}°: bed 20 is in the wrong place`);
  }
});

/** Rotation of the board in the frame, in degrees, around the frame point (cx, cy). */
function rotatedView(spin, { cx = 240, cy = 180, scale = 130 } = {}) {
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const a = (spin * Math.PI) / 180;
  const rotated = corners.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
  return solveHomography(corners, rotated.map(([x, y]) => [cx + scale * x, cy + scale * y]));
}

/** Asserts that the calibration puts the given beds where the true pose has them. */
function assertBeds(truth, result, message) {
  assert.ok(!result.error, `${message}: ${result.error}`);
  const cases = [
    { angle: 0, radius: TRIPLE, expect: 'T20' },
    { angle: 90, radius: 0.4, expect: '6' },
    { angle: 180, radius: DOUBLE, expect: 'D3' },
    { angle: 342, radius: 0.8, expect: '5' }
  ];
  for (const c of cases) {
    const [ix, iy] = applyHomography(truth, boardPoint(c.angle, c.radius));
    assert.equal(scoreAtImage(result, ix, iy).label, c.expect, `${message}, angle ${c.angle}°`);
  }
}

const TRIPLE = (RADII.tripleInner + RADII.tripleOuter) / 2;
const DOUBLE = (RADII.doubleInner + 1) / 2;

test('warm light does not turn sisal or wood into red beds', () => {
  assert.equal(classifyColor(220, 160, 90), null, 'sisal under a warm bulb');
  assert.equal(classifyColor(200, 140, 90), null, 'wooden cabinet');
  assert.equal(classifyColor(150, 60, 45), 'red', 'red bed under a warm bulb');
  assert.equal(classifyColor(40, 90, 170), 'green', 'blue bed of a soft-tip board');
});

test('a soft-tip board with bed 20 light and green-ringed is numbered correctly', () => {
  // Colour cannot tell this layout from the steel-tip one, so it is recognised only when the board hangs level.
  for (const spin of [0, -2, 2]) {
    const truth = rotatedView(spin);
    const result = detectBoard(renderBoard(truth, { reversed: true }));
    assertBeds(truth, result, `reversed colours, rotation ${spin}°`);
    assert.equal(result.quality.reversedColours, true);
  }
});

test('a board in a red and green surround is still found', () => {
  const truth = cameraView({ scale: 90 });
  const image = renderBoard(truth, {
    rings: [
      { from: 1.3, to: 1.7, color: [205, 45, 35] },
      { from: 1.7, to: 2.3, color: [90, 200, 160] }
    ]
  });
  const result = detectBoard(image);
  assertBeds(truth, result, 'coloured surround');
  assert.ok(mappingError(truth, result) < 0.02);
});

test('a board under strongly tinted light is still found', () => {
  const truth = cameraView({ skewX: 0.12 });
  const result = detectBoard(renderBoard(truth, { tint: [1.1, 0.85, 0.6] }));
  assertBeds(truth, result, 'warm light');
});

test('a board with blue beds in place of green is found', () => {
  const truth = cameraView();
  const result = detectBoard(renderBoard(truth, { colors: { green: [35, 80, 170], outerBull: [35, 80, 170] } }));
  assertBeds(truth, result, 'blue beds');
});

test('a small board among red and green objects is found', () => {
  const truth = cameraView({ cx: 300, cy: 200, scale: 42 });
  const clutter = [
    { x: 20, y: 30, w: 60, h: 40, color: [200, 40, 40] },
    { x: 80, y: 30, w: 50, h: 40, color: [40, 150, 60] },
    { x: 40, y: 250, w: 30, h: 80, color: [190, 30, 50] },
    { x: 420, y: 40, w: 40, h: 25, color: [30, 140, 70] }
  ];
  const result = detectBoard(renderBoard(truth, { clutter }));
  assertBeds(truth, result, 'small board');
  assert.ok(mappingError(truth, result) < 0.04);
});

test('a frame without a board ends with a clear message, not a result', () => {
  const blank = { width: 200, height: 150, data: new Uint8ClampedArray(200 * 150 * 4).fill(90) };
  const result = detectBoard(blank);
  assert.ok(result.error, 'an empty frame should not give a calibration');
  assert.match(result.error, /^calib\./, 'the message comes back as a text key');
});
