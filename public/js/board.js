// Draws the interactive SVG dartboard (fallback / no-camera mode).

import { SEGMENTS, RADII, scoreAtBoard } from './geometry.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const R = 100; // radius of the outer double edge in SVG units

const COLORS = {
  black: '#141a2c',
  cream: '#dfe3ee',
  red: '#ff5b4f',
  green: '#1fd19d',
  wire: '#070a13'
};

/** A point on the board: angle in degrees (0 = top, clockwise), radius in SVG units. */
function pt(angleDeg, radius) {
  const a = (angleDeg * Math.PI) / 180;
  return [radius * Math.sin(a), -radius * Math.cos(a)];
}

function annularSector(a1, a2, r1, r2) {
  const [x1, y1] = pt(a1, r2);
  const [x2, y2] = pt(a2, r2);
  const [x3, y3] = pt(a2, r1);
  const [x4, y4] = pt(a1, r1);
  return [
    `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `A ${r2} ${r2} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `L ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    `A ${r1} ${r1} 0 0 0 ${x4.toFixed(2)} ${y4.toFixed(2)}`,
    'Z'
  ].join(' ');
}

function el(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/**
 * Draws the board inside an <svg> element and wires up click handling.
 * @param {SVGSVGElement} svg
 * @param {(score:object, point:{x:number,y:number}) => void} onPick
 */
export function renderBoard(svg, onPick) {
  svg.setAttribute('viewBox', '-118 -118 236 236');
  svg.innerHTML = '';

  svg.appendChild(el('circle', { cx: 0, cy: 0, r: 117, fill: '#0e1322', stroke: '#232c46', 'stroke-width': 1 }));

  const rings = [
    { r1: RADII.outerBull * R, r2: RADII.tripleInner * R, kind: 'single' },
    { r1: RADII.tripleInner * R, r2: RADII.tripleOuter * R, kind: 'ring' },
    { r1: RADII.tripleOuter * R, r2: RADII.doubleInner * R, kind: 'single' },
    { r1: RADII.doubleInner * R, r2: R, kind: 'ring' }
  ];

  SEGMENTS.forEach((sector, i) => {
    const center = i * 18;
    const a1 = center - 9;
    const a2 = center + 9;
    const dark = i % 2 === 0; // 20 (index 0) is black

    for (const ring of rings) {
      const fill = ring.kind === 'single'
        ? (dark ? COLORS.black : COLORS.cream)
        : (dark ? COLORS.red : COLORS.green);
      svg.appendChild(el('path', {
        d: annularSector(a1, a2, ring.r1, ring.r2),
        fill,
        stroke: COLORS.wire,
        'stroke-width': 0.7
      }));
    }

    const [tx, ty] = pt(center, 110);
    const label = el('text', {
      x: tx.toFixed(2),
      y: ty.toFixed(2),
      fill: '#edf0f7',
      'font-size': 12,
      'font-weight': 600,
      'font-family': 'Oswald, system-ui, sans-serif',
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'pointer-events': 'none'
    });
    label.textContent = String(sector);
    svg.appendChild(label);
  });

  svg.appendChild(el('circle', {
    cx: 0, cy: 0, r: RADII.outerBull * R, fill: COLORS.green, stroke: COLORS.wire, 'stroke-width': 0.7
  }));
  svg.appendChild(el('circle', {
    cx: 0, cy: 0, r: RADII.innerBull * R, fill: COLORS.red, stroke: COLORS.wire, 'stroke-width': 0.7
  }));

  const marker = el('circle', { cx: 0, cy: 0, r: 3.2, fill: 'none', stroke: '#ffb443', 'stroke-width': 1.8, opacity: 0, 'pointer-events': 'none' });
  svg.appendChild(marker);

  svg.addEventListener('click', (event) => {
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(ctm.inverse());

    const score = scoreAtBoard(local.x / R, local.y / R);
    marker.setAttribute('cx', local.x.toFixed(2));
    marker.setAttribute('cy', local.y.toFixed(2));
    marker.setAttribute('opacity', '1');
    onPick(score, { x: local.x / R, y: local.y / R });
  });

  return {
    clearMarker() {
      marker.setAttribute('opacity', '0');
    }
  };
}
