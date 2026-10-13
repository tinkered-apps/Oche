// Game logic for 101 / 301 / 501 (two players).
//
// The game state is ALWAYS computed from scratch out of the throw list (`throws`).
// That makes "undo" simply removing the last throw and recomputing.

export const DARTS_PER_TURN = 3;

export const DEFAULT_CONFIG = {
  players: ['Player 1', 'Player 2'],
  startScore: 301,
  doubleOut: false,
  /**
   * Smallest gap (in millimetres on the board) between separate hits.
   * Anything closer is taken for the same dart, for example one still shaking after it lands.
   */
  minGapMm: 8
};

/**
 * @typedef {{points:number, ring:string, sector:number, label:string}} Throw
 */

/** Whether a throw counts as a "double" for finishing the game (double out). */
export function isDoubleThrow(t) {
  return t.ring === 'double' || t.ring === 'bull';
}

/**
 * Computes the full game state from the event list.
 *
 * An event is a throw or a manual end of turn `{ end: true }`
 * (`force: true` ends even a turn without a single dart, i.e. "Skip turn").
 * @param {object} config
 * @param {Array<Throw|{end:true, force?:boolean}>} throwsList
 */
export function computeState(config, throwsList) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const playerCount = cfg.players.length;

  const scores = cfg.players.map(() => cfg.startScore);
  const stats = cfg.players.map(() => ({ darts: 0, scored: 0, bestTurn: 0, turns: 0 }));
  const turns = []; // finished turns: {player, darts, scored, bust, from, to}

  let current = 0;
  let turnDarts = [];
  let turnStart = cfg.startScore;
  let winner = null;

  const finishTurn = (bust) => {
    const scored = bust ? 0 : turnStart - scores[current];
    if (bust) scores[current] = turnStart;
    turns.push({
      player: current,
      darts: [...turnDarts],
      scored,
      bust,
      from: turnStart,
      to: scores[current]
    });
    stats[current].scored += scored;
    stats[current].turns += 1;
    stats[current].bestTurn = Math.max(stats[current].bestTurn, scored);
    turnDarts = [];
    current = (current + 1) % playerCount;
    turnStart = scores[current];
  };

  for (let index = 0; index < throwsList.length; index++) {
    const t = throwsList[index];
    if (winner !== null) break;

    if (t && t.end) {
      if (turnDarts.length || t.force) finishTurn(false);
      continue;
    }

    turnDarts.push({ ...t, index });
    stats[current].darts += 1;
    const remaining = scores[current] - t.points;

    const bustNegative = remaining < 0;
    const bustOne = cfg.doubleOut && remaining === 1;
    const bustBadFinish = cfg.doubleOut && remaining === 0 && !isDoubleThrow(t);

    if (bustNegative || bustOne || bustBadFinish) {
      finishTurn(true);
      continue;
    }

    scores[current] = remaining;

    if (remaining === 0) {
      winner = current;
      finishTurn(false);
      break;
    }
    if (turnDarts.length >= DARTS_PER_TURN) {
      finishTurn(false);
    }
  }

  return {
    config: cfg,
    scores,
    stats,
    turns,
    current: winner !== null ? winner : current,
    turnDarts,
    turnStart,
    dartsLeft: DARTS_PER_TURN - turnDarts.length,
    winner,
    finished: winner !== null
  };
}

// ---------------------------------------------------------------------------
// Checkout hints
// ---------------------------------------------------------------------------

/** Every possible value of a single dart, highest first. */
function allTargets() {
  const list = [{ points: 50, label: 'BULL', double: true }, { points: 25, label: '25', double: false }];
  for (let n = 1; n <= 20; n++) {
    list.push({ points: n * 3, label: `T${n}`, double: false });
    list.push({ points: n * 2, label: `D${n}`, double: true });
    list.push({ points: n, label: String(n), double: false });
  }
  return list.sort((a, b) => b.points - a.points);
}

const TARGETS = allTargets();
const FINISHERS_DOUBLE = TARGETS.filter((t) => t.double);

/**
 * Finds the shortest checkout path to zero.
 * @param {number} remaining points left
 * @param {number} dartsLeft darts left in the turn
 * @param {boolean} doubleOut whether the finish must be a double
 * @returns {string[]|null} e.g. ['T20','T20','D10']
 */
export function suggestCheckout(remaining, dartsLeft, doubleOut) {
  if (remaining <= 0 || dartsLeft <= 0) return null;
  const finishers = doubleOut ? FINISHERS_DOUBLE : TARGETS;

  const search = (left, depth) => {
    if (depth === 1) {
      const hit = finishers.find((t) => t.points === left);
      return hit ? [hit.label] : null;
    }
    for (const t of TARGETS) {
      const rest = left - t.points;
      if (rest <= 0) continue;
      if (doubleOut && rest === 1) continue;
      const tail = search(rest, depth - 1);
      if (tail) return [t.label, ...tail];
    }
    return null;
  };

  for (let depth = 1; depth <= dartsLeft; depth++) {
    const path = search(remaining, depth);
    if (path) return path;
  }
  return null;
}

/** Average per turn (3 darts) for a player. */
export function turnAverage(playerStats) {
  if (!playerStats.darts) return 0;
  return (playerStats.scored / playerStats.darts) * DARTS_PER_TURN;
}
