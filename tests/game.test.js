import test from 'node:test';
import assert from 'node:assert/strict';

import { computeState, suggestCheckout, turnAverage, isDoubleThrow } from '../public/js/game.js';

/** Shorthand for building a throw: 'T20', 'D16', '5', 'BULL', '25', 'MISS'. */
function d(label) {
  if (label === 'BULL') return { points: 50, ring: 'bull', sector: 50, label };
  if (label === '25') return { points: 25, ring: 'outerBull', sector: 25, label };
  if (label === 'MISS') return { points: 0, ring: 'out', sector: 0, label };
  const mult = label[0] === 'T' ? 3 : label[0] === 'D' ? 2 : 1;
  const sector = Number(mult === 1 ? label : label.slice(1));
  return { points: sector * mult, ring: mult === 3 ? 'triple' : mult === 2 ? 'double' : 'single', sector, label };
}

const cfg = (extra = {}) => ({ players: ['A', 'B'], startScore: 301, doubleOut: false, ...extra });

test('points are subtracted from 301', () => {
  const s = computeState(cfg(), [d('T20'), d('20'), d('5')]);
  assert.equal(s.scores[0], 301 - 60 - 20 - 5);
  assert.equal(s.scores[1], 301);
});

test('a turn lasts 3 darts, then the player changes', () => {
  const s2 = computeState(cfg(), [d('20'), d('20')]);
  assert.equal(s2.current, 0);
  assert.equal(s2.dartsLeft, 1);

  const s3 = computeState(cfg(), [d('20'), d('20'), d('20')]);
  assert.equal(s3.current, 1);
  assert.equal(s3.turnDarts.length, 0);
  assert.equal(s3.turns.length, 1);
  assert.equal(s3.turns[0].scored, 60);
});

test('a miss counts as a dart and zero points', () => {
  const s = computeState(cfg(), [d('MISS'), d('MISS'), d('MISS')]);
  assert.equal(s.scores[0], 301);
  assert.equal(s.stats[0].darts, 3);
  assert.equal(s.current, 1);
});

test('a bust restores the score from before the turn and ends it', () => {
  // A gets down to 30, then tries T20 (60): bust.
  const throwsList = [
    d('T20'), d('T20'), d('T20'),   // A: 301 -> 121
    d('BULL'), d('BULL'), d('BULL'), // B: 301 -> 151
    d('T20'), d('T17')               // A: 121 -> 61 -> 10
  ];
  const before = computeState(cfg(), throwsList);
  assert.equal(before.scores[0], 10);

  const busted = computeState(cfg(), [...throwsList, d('T20')]);
  assert.equal(busted.scores[0], 121, 'the score returns to where it was at the start of the turn');
  assert.equal(busted.current, 1, 'the turn passes to the other player');
  assert.equal(busted.turns.at(-1).bust, true);
  assert.equal(busted.turns.at(-1).scored, 0);
});

test('without double out any bed can finish', () => {
  const throwsList = [d('T20'), d('T20'), d('T20'), d('MISS'), d('MISS'), d('MISS')];
  const state = computeState(cfg(), [...throwsList, d('T20'), d('T20'), d('1')]);
  assert.equal(state.scores[0], 0);
  assert.equal(state.winner, 0);
  assert.equal(state.finished, true);
});

test('with double out the finish must be a double, and leaving 1 is a bust', () => {
  const opening = [d('T20'), d('T20'), d('T20'), d('MISS'), d('MISS'), d('MISS')]; // A: 121

  // The D20 would leave 1 (a bust), so the later single 1 cannot finish either
  const single = computeState(cfg({ doubleOut: true }), [...opening, d('T20'), d('20'), d('D20'), d('MISS'), d('MISS'), d('MISS'), d('1')]);
  assert.equal(single.winner, null);

  // 121 -> T20 (61) -> 20 (41) -> D20 would leave 1 point = bust
  const leaveOne = computeState(cfg({ doubleOut: true }), [...opening, d('T20'), d('20'), d('D20')]);
  assert.equal(leaveOne.scores[0], 121, 'D20 from 41 would leave 1 -> bust');
  assert.equal(leaveOne.turns.at(-1).bust, true);

  // A valid finish from 121: T20 (61) -> 25 (36) -> D18 (0)
  const win = computeState(cfg({ doubleOut: true }), [...opening, d('T20'), d('25'), d('D18')]);
  assert.equal(win.scores[0], 0);
  assert.equal(win.winner, 0);
});

test('the bulls-eye finishes the game in double-out mode', () => {
  const state = computeState(cfg({ startScore: 101, doubleOut: true }), [d('T17'), d('BULL')]);
  assert.equal(state.scores[0], 0);
  assert.equal(state.winner, 0);
  assert.ok(isDoubleThrow(d('BULL')));
});

test('throws after the win are ignored', () => {
  const base = [d('T20'), d('T20'), d('T20'), d('MISS'), d('MISS'), d('MISS'), d('T20'), d('T20'), d('1')];
  const state = computeState(cfg(), [...base, d('T20'), d('T20')]);
  assert.equal(state.winner, 0);
  assert.equal(state.scores[0], 0);
  assert.equal(state.stats[0].darts, 6, 'darts after the end of the game are not counted');
});

test('undo = recomputing a shorter throw list', () => {
  const throwsList = [d('T20'), d('19'), d('D10')];
  const full = computeState(cfg(), throwsList);
  const undone = computeState(cfg(), throwsList.slice(0, -1));
  assert.equal(full.scores[0], 301 - 60 - 19 - 20);
  assert.equal(undone.scores[0], 301 - 60 - 19);
  assert.equal(undone.dartsLeft, 1);
});

test('stats: dart count, total and best turn', () => {
  const state = computeState(cfg(), [d('T20'), d('T20'), d('T20'), d('20'), d('20'), d('20'), d('5'), d('5')]);
  assert.equal(state.stats[0].darts, 5);
  assert.equal(state.stats[0].bestTurn, 180);
  assert.equal(state.stats[1].bestTurn, 60);
  assert.equal(turnAverage(state.stats[1]).toFixed(1), '60.0');
});

test('checkout hints', () => {
  assert.deepEqual(suggestCheckout(40, 3, true), ['D20']);
  assert.deepEqual(suggestCheckout(2, 1, true), ['D1']);
  assert.deepEqual(suggestCheckout(170, 3, true), ['T20', 'T20', 'BULL']);
  assert.deepEqual(suggestCheckout(60, 1, false), ['T20']);
  assert.equal(suggestCheckout(3, 1, true), null, 'an odd number cannot be finished with one double');
  assert.equal(suggestCheckout(171, 3, true), null, 'above 170 there is no checkout in 3 darts');

  const path = suggestCheckout(100, 3, true);
  assert.ok(path && path.length <= 3);
});

test('switching player by hand ends the turn before the third dart', () => {
  const state = computeState(cfg(), [d('T20'), d('20'), { end: true }]);
  assert.equal(state.scores[0], 301 - 80);
  assert.equal(state.current, 1, 'the turn moves on despite only two darts');
  assert.equal(state.turns.at(-1).darts.length, 2);
});

test('ending an empty turn only works on explicit request', () => {
  const ignored = computeState(cfg(), [{ end: true }]);
  assert.equal(ignored.current, 0, 'an accidental press does not hand over the turn');

  const skipped = computeState(cfg(), [{ end: true, force: true }]);
  assert.equal(skipped.current, 1, '"Skip turn" hands over the turn without a throw');
});

test('after the third dart the turn ends by itself, and the button does not take the next one', () => {
  const auto = computeState(cfg(), [d('20'), d('20'), d('20')]);
  assert.equal(auto.current, 1);
  const afterButton = computeState(cfg(), [d('20'), d('20'), d('20'), { end: true }]);
  assert.equal(afterButton.current, 1, 'the other player does not lose their turn');
});
