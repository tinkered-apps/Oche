// Draws the board grid and dart markers over the camera image.

import { RADII, SEGMENTS, applyHomography } from './geometry.js';

function boardPoint(calibration, angleDeg, radius) {
  const a = (angleDeg * Math.PI) / 180;
  return applyHomography(calibration.boardToImage, [radius * Math.sin(a), -radius * Math.cos(a)]);
}

/** A dark outline underneath makes the line readable on both sisal and black. */
const HALO = 'rgba(7, 10, 19, 0.55)';

function strokeBoardCircle(ctx, calibration, radius, color, width) {
  ctx.beginPath();
  for (let i = 0; i <= 120; i++) {
    const [x, y] = boardPoint(calibration, (i / 120) * 360, radius);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.strokeStyle = HALO;
  ctx.lineWidth = width + 2;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

/**
 * Draws the board grid computed from the calibration.
 * The colour comes from the app palette: the light blue of the "watching" state,
 * which shows well on both sisal and a black bed.
 */
export function drawBoardGrid(ctx, calibration, scale = 1) {
  const thin = 1.5 * scale;
  const thick = 2.5 * scale;

  strokeBoardCircle(ctx, calibration, RADII.doubleOuter, 'rgba(108, 184, 255, 0.95)', thick);
  strokeBoardCircle(ctx, calibration, RADII.doubleInner, 'rgba(108, 184, 255, 0.6)', thin);
  strokeBoardCircle(ctx, calibration, RADII.tripleOuter, 'rgba(108, 184, 255, 0.6)', thin);
  strokeBoardCircle(ctx, calibration, RADII.tripleInner, 'rgba(108, 184, 255, 0.6)', thin);
  strokeBoardCircle(ctx, calibration, RADII.outerBull, 'rgba(108, 184, 255, 0.85)', thin);
  strokeBoardCircle(ctx, calibration, RADII.innerBull, 'rgba(108, 184, 255, 0.95)', thin);

  for (let i = 0; i < 20; i++) {
    const angle = i * 18 + 9;
    const [x1, y1] = boardPoint(calibration, angle, RADII.outerBull);
    const [x2, y2] = boardPoint(calibration, angle, RADII.doubleOuter);
    if (!Number.isFinite(x1) || !Number.isFinite(x2)) continue;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = HALO;
    ctx.lineWidth = thin + 1.5;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(108, 184, 255, 0.4)';
    ctx.lineWidth = thin;
    ctx.stroke();
  }

  ctx.font = `600 ${Math.round(16 * scale)}px Oswald, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3 * scale;
  ctx.strokeStyle = HALO;
  SEGMENTS.forEach((sector, i) => {
    const [x, y] = boardPoint(calibration, i * 18, 1.1);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    ctx.strokeText(String(sector), x, y);
    ctx.fillStyle = 'rgba(108, 184, 255, 0.95)';
    ctx.fillText(String(sector), x, y);
  });
}

/** A hit marker. */
export function drawMarker(ctx, x, y, label, { color = '#edf0f7', scale = 1, pending = false } = {}) {
  const r = 10 * scale;
  const shape = () => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - r * 1.6, y);
    ctx.lineTo(x + r * 1.6, y);
    ctx.moveTo(x, y - r * 1.6);
    ctx.lineTo(x, y + r * 1.6);
    ctx.stroke();
  };

  ctx.strokeStyle = HALO;
  ctx.lineWidth = 4.5 * scale;
  shape();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5 * scale;
  shape();

  if (label) {
    ctx.font = `600 ${Math.round((pending ? 22 : 18) * scale)}px Oswald, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const ty = y - r * 1.9;
    ctx.lineWidth = 4 * scale;
    ctx.strokeStyle = 'rgba(7, 10, 19, 0.8)';
    ctx.strokeText(label, x, ty);
    ctx.fillStyle = color;
    ctx.fillText(label, x, ty);
  }
}

/** A calibration point with its step number. */
export function drawCalibrationPoint(ctx, x, y, index, scale = 1) {
  ctx.fillStyle = '#ffb443';
  ctx.beginPath();
  ctx.arc(x, y, 7 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#070a13';
  ctx.font = `600 ${Math.round(12 * scale)}px Oswald, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(index + 1), x, y);
}
