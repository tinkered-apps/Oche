// Ties it all together: camera → automatic board detection → continuous dart
// detection → 301 scoring. The player marks nothing by hand; the only thing to
// set up is the names, and the only button during play hands over the turn.

import {
  scoreAtImage,
  applyHomography,
  multiply,
  invert,
  alternativesFor,
  scoreFor,
  SEGMENTS
} from './geometry.js';
import { detectBoard } from './autocalib.js';
import { buildBoardMask } from './detect.js';
import { createTracker, WATCH } from './watcher.js';
import { renderBoard } from './board.js';
import { computeState, turnAverage, suggestCheckout, DEFAULT_CONFIG, DARTS_PER_TURN } from './game.js';
import { startCamera, stopCamera, grabFrame, cameraSupported, isRunning } from './camera.js';
import { drawBoardGrid, drawMarker } from './overlay.js';
import * as storage from './storage.js';
import {
  t,
  setLanguage,
  getLanguage,
  applyStaticTranslations,
  describeScore,
  defaultPlayerName,
  isDefaultPlayerName,
  DEFAULT_LANGUAGE
} from './i18n.js';

/**
 * The app version shown in the footer. The service worker's CACHE carries the
 * same number (public/sw.js); tests/version.test.js fails if they differ.
 */
const APP_VERSION = '1.02';

/** Width of the frame the image analysis works on. */
const ANALYSIS_WIDTH = 480;
/** How often, in milliseconds, we look at the board. */
const TICK_MS = 220;
/** Board radius in millimetres, for converting settings to board units. */
const BOARD_RADIUS_MM = 170;
const $ = (id) => document.getElementById(id);

const dom = {
  players: [$('player0'), $('player1')],
  status: $('status'),
  statusText: $('statusText'),
  video: $('video'),
  overlay: $('overlay'),
  stage: $('stage'),
  stageMsg: $('stageMsg'),
  boardSvg: $('boardSvg'),
  turnButton: $('btnTurn'),
  menuDialog: $('menuDialog'),
  winDialog: $('winDialog'),
  winText: $('winText'),
  calibrationNote: $('calibrationNote'),
  throws: $('throws'),
  editDialog: $('editDialog'),
  editTitle: $('editTitle'),
  editNote: $('editNote'),
  editSuggestions: $('editSuggestions'),
  editPicker: $('editPicker')
};

const app = {
  config: { ...DEFAULT_CONFIG },
  events: [],            // throws and manual turn ends
  state: null,
  calibration: null,     // homographies in analysis-frame pixels
  view: null,            // the same homographies scaled to the preview resolution
  frameSize: null,
  scale: 1,
  tracker: createTracker(),
  timer: null,
  calibrating: false,
  awaitingPull: false,   // darts are still in the board; waiting for them to be pulled
  watchStatus: null,
  flash: null,
  flashTone: 'ok',
  flashUntil: 0,
  quality: null,
  lastEntry: null,       // index of the dart entered on the keypad, highlighted on its tile
  keypadRing: 'single',  // multiplier armed on the keypad; the next dart uses it up
  boardApi: null,
  announcedWinner: null,
  editing: null,        // index of the throw being edited in the event list
  pickerRing: 'single'
};

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

function recompute() {
  app.state = computeState(app.config, app.events);
  storage.saveGame(app.config, app.events);
  render();
}

/** Appends a throw. Returns `true` if it actually made it onto the list. */
function addThrow(score, source) {
  if (app.state.finished || app.awaitingPull) return false;

  const before = app.state.current;
  app.events.push({
    points: score.points,
    ring: score.ring,
    sector: score.sector,
    label: score.label,
    board: score.board || null,
    uncertain: Boolean(score.uncertain),
    margin: score.margin ?? null,
    source
  });
  app.state = computeState(app.config, app.events);

  // Turn closed (third dart or a win): the darts have to be pulled.
  // Only in camera play; with manual entry nothing is stuck in the board.
  if (app.state.finished || app.state.current !== before || app.state.turnDarts.length === 0) {
    if (isCameraMode()) app.awaitingPull = true;
  }

  const closedTurn = app.state.turnDarts.length === 0 ? app.state.turns[app.state.turns.length - 1] : null;
  const described = describeScore(score);
  if (closedTurn && closedTurn.bust) {
    setFlash(t('flash.bust', { score: closedTurn.from }), 'warn');
  } else {
    setFlash(score.uncertain
      ? t('flash.uncertain', { score: described })
      : source === 'manual' ? t('flash.manual', { score: described }) : described);
  }
  if (navigator.vibrate) navigator.vibrate(score.points ? 35 : [15, 40, 15]);
  storage.saveGame(app.config, app.events);
  render();
  return true;
}

function endTurn({ force = false } = {}) {
  if (app.state.finished) return;
  if (!force && !app.state.turnDarts.length && !app.awaitingPull) return;
  if (app.state.turnDarts.length || force) app.events.push({ end: true, force });
  if (isCameraMode()) app.awaitingPull = true;
  app.lastEntry = null;
  app.keypadRing = 'single';
  app.flash = null;
  recompute();
}

function undo() {
  if (!app.events.length) return;
  app.events.pop();
  app.lastEntry = null;
  app.keypadRing = 'single';
  app.announcedWinner = null;
  app.awaitingPull = false;
  app.flash = null;
  restartWatching();
  recompute();
}

function newGame() {
  app.events = [];
  app.lastEntry = null;
  app.keypadRing = 'single';
  app.announcedWinner = null;
  app.awaitingPull = false;
  app.flash = null;
  restartWatching();
  recompute();
}

/**
 * Clears the remembered background and says so in the status bar right away.
 * Otherwise "Waiting for a dart" would still show for a split second while the
 * background is only being learned, and a dart thrown then would sink into the
 * background and be lost.
 */
function restartWatching() {
  app.tracker.reset();
  app.watchStatus = WATCH.SETTLING;
  if (isCameraMode()) setStatus('search', t('status.settling'));
}

/**
 * Darts pulled: refresh the board fit first, and only then go back to
 * watching. The order matters. Refreshing clears the remembered background, so
 * if it happened after resuming, a dart thrown in that same second would blend
 * into the new background and never be counted.
 */
async function resumeAfterPull() {
  app.flash = null;
  if (isRunning()) await calibrate({ attempts: 2, quiet: true });
  app.awaitingPull = false;
  restartWatching();
  render();
}

/** Hits shown in the strip: the current turn, or the one that has just closed. */
function visibleThrows() {
  const s = app.state;
  if (s.turnDarts.length) return s.turnDarts;
  const last = s.turns[s.turns.length - 1];
  return last && (app.awaitingPull || s.finished || app.lastEntry !== null) ? last.darts : [];
}

/** Replaces the throw at the given index with another bed. */
function editThrow(index, score) {
  const previous = app.events[index];
  if (!previous || previous.end) return;

  app.events[index] = {
    ...previous,
    points: score.points,
    ring: score.ring,
    sector: score.sector,
    label: score.label,
    uncertain: false,
    source: 'edited'
  };

  // The fix may itself bust the turn (or undo a bust), so check the
  // so check it on the recomputed state before setting the message.
  const state = computeState(app.config, app.events);
  const turn = state.turns.find((candidate) => candidate.darts.some((d) => d.index === index));
  if (turn && turn.bust) {
    setFlash(t('flash.bust', { score: turn.from }), 'warn');
  } else {
    setFlash(t('flash.edited', { score: describeScore(score) }));
  }
  recompute();
}

function deleteThrow(index) {
  if (!app.events[index] || app.events[index].end) return;
  app.events.splice(index, 1);
  app.lastEntry = null;
  app.state = computeState(app.config, app.events);

  // The turn is open again, so the missing dart can be added.
  if (!app.state.finished && app.state.turnDarts.length < DARTS_PER_TURN) app.awaitingPull = false;
  setFlash(t('flash.deleted'));
  recompute();
}

function openEditor(index) {
  const record = app.events[index];
  if (!record || record.end) return;
  app.editing = index;

  dom.editTitle.textContent = t('edit.titleWith', { label: record.label });
  dom.editNote.textContent = record.uncertain
    ? t('edit.noteUncertain')
    : record.source === 'edited'
      ? t('edit.noteEdited')
      : t('edit.noteDefault');

  dom.editSuggestions.innerHTML = '';
  for (const candidate of alternativesFor(record)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = `${candidate.label}<small>${t('slot.points', { points: candidate.points })}</small>`;
    button.addEventListener('click', () => {
      editThrow(index, candidate);
      dom.editDialog.close();
    });
    dom.editSuggestions.appendChild(button);
  }

  $('editPicker').open = false;
  dom.editDialog.showModal();
}

function buildPicker() {
  const numbers = $('pickerNumbers');
  numbers.innerHTML = '';
  for (const sector of [...SEGMENTS].sort((a, b) => a - b)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(sector);
    button.addEventListener('click', () => {
      if (app.editing === null) return;
      editThrow(app.editing, scoreFor(sector, app.pickerRing));
      dom.editDialog.close();
    });
    numbers.appendChild(button);
  }

  $('pickerRings').addEventListener('click', (event) => {
    const ring = event.target.dataset.ring;
    if (!ring) return;
    app.pickerRing = ring;
    $('pickerRings').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.ring === ring));
  });

  $('pickerSpecial').addEventListener('click', (event) => {
    const special = event.target.dataset.special;
    if (!special || app.editing === null) return;
    editThrow(app.editing, scoreFor(special === 'bull' ? 50 : special === 'outerBull' ? 25 : 0, special));
    dom.editDialog.close();
  });
}

// ---------------------------------------------------------------------------
// Camera, calibration, watching
// ---------------------------------------------------------------------------

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Are we working with the camera? Manual modes have nothing to report. */
function isCameraMode() {
  return (app.config.mode || 'camera') === 'camera';
}

/** The hint that matches the manual mode. */
function manualHint() {
  return (app.config.mode === 'keypad') ? t('hint.keypad') : t('hint.board');
}

async function enableCamera() {
  if (!isCameraMode()) return;
  if (!cameraSupported()) {
    showStageMessage(`<p>${t('stage.blocked')}</p>`);
    return;
  }
  showStageMessage(`<p>${t('stage.starting')}</p>`);
  try {
    await startCamera(dom.video);
    syncCanvasSize();
    hideStageMessage();
    setStatus('search', t('status.searching'));
    await delay(500);
    await calibrate();
    startWatching();
  } catch (err) {
    // The camera error is sometimes our text key, sometimes a sentence from the browser;
    // `t` passes the latter through unchanged.
    showStageMessage(`<p>${t('stage.failed', { message: t(err.message) })}</p>`
      + `<button type="button" class="primary" id="btnStartCamera">${t('stage.retry')}</button>`);
  }
  render();
}

/** Looks for the board in the frame; on failure, says what to fix. */
async function calibrate({ attempts = 8, quiet = false } = {}) {
  if (app.calibrating) return false;
  app.calibrating = true;

  try {
    let lastError = 'status.waiting';
    for (let attempt = 0; attempt < attempts; attempt++) {
      // The player may have switched to a manual mode in the meantime. Then
      // searching for the board is pointless and its messages have nowhere to go.
      if (!isCameraMode()) return false;

      const frame = grabFrame(dom.video, ANALYSIS_WIDTH);
      const found = frame ? detectBoard(frame) : null;

      if (found && !found.error) {
        adoptCalibration(found, frame);
        if (!quiet) setStatus('ok', t('status.found'));
        return true;
      }
      lastError = (found && found.error) || lastError;
      if (!quiet && isCameraMode()) setStatus('search', t(lastError));
      await delay(450);
    }
    if (!quiet && isCameraMode()) setStatus('warn', t(lastError));
    return false;
  } finally {
    app.calibrating = false;
    render();
  }
}

function adoptCalibration(found, frame) {
  app.calibration = found;
  app.quality = found.quality;
  app.frameSize = { width: frame.width, height: frame.height };
  app.scale = dom.overlay.width ? dom.overlay.width / frame.width : 1;

  const scaleMatrix = [app.scale, 0, 0, 0, app.scale, 0, 0, 0, 1];
  const boardToImage = multiply(scaleMatrix, found.boardToImage);
  app.view = { boardToImage, imageToBoard: invert(boardToImage) };

  const { mask, count } = buildBoardMask(found.imageToBoard, frame.width, frame.height, applyHomography);
  app.tracker.setBoardMask(mask, count);
}

function startWatching() {
  if (app.timer) clearInterval(app.timer);
  app.timer = setInterval(tick, TICK_MS);
}

function tick() {
  if (!isCameraMode()) return;
  if (!isRunning() || !app.calibration || app.calibrating) return;
  if (app.state.finished) return;

  if (app.awaitingPull) {
    setStatus('warn', t('status.pull', { name: app.state.config.players[app.state.current] }));
    return;
  }

  const frame = grabFrame(dom.video, ANALYSIS_WIDTH);
  if (!frame || !app.frameSize || frame.width !== app.frameSize.width) return;

  const result = app.tracker.push(frame);
  app.watchStatus = result.status;

  if (result.status !== WATCH.DARTS) {
    setStatus(...describeWatch(result));
    return;
  }

  // No cooldown here: the tracker has already taken this frame as its new
  // background, so a result dropped now would be a dart lost for good. A dart still
  // shaking after it is counted is caught by isAlreadyCounted below.
  const remaining = DARTS_PER_TURN - app.state.turnDarts.length;
  const darts = result.darts.slice(0, Math.max(0, remaining));

  for (const dart of darts) {
    const score = scoreAtImage(app.calibration, dart.x, dart.y);

    if (isAlreadyCounted(score.board)) {
      setFlash(t('flash.duplicate'));
      render();
      continue;
    }

    addThrow(score, 'auto');
    if (app.state.finished || app.awaitingPull) break;
  }
}

/**
 * Is there already a counted dart from this turn at this spot? The threshold
 * comes from the settings: a smaller one counts tight groups better, a larger
 * one filters out a dart still shaking after it lands.
 */
function isAlreadyCounted(board) {
  if (!board) return false;
  const limit = (app.config.minGapMm ?? DEFAULT_CONFIG.minGapMm) / BOARD_RADIUS_MM;
  return app.state.turnDarts.some((t) => t.board
    && Math.hypot(t.board[0] - board[0], t.board[1] - board[1]) < limit);
}

function describeWatch(result) {
  switch (result.status) {
    case WATCH.BASELINE: return ['ok', t('watch.baseline')];
    case WATCH.WATCHING: return ['ok', t('watch.watching')];
    case WATCH.CONFIRMING: return ['search', t('watch.confirming')];
    case WATCH.MOTION: return ['search', t('watch.motion')];
    case WATCH.OCCLUDED: return ['warn', t('watch.occluded')];
    default: return ['search', t('watch.settling')];
  }
}

function setStatus(tone, text) {
  app.status = { tone, text };
  const flash = activeFlash();
  dom.status.dataset.tone = flash ? app.flashTone : tone;
  dom.statusText.textContent = flash || text;
}

/** A hit message shows for a moment, then the current board state returns. */
function setFlash(text, tone = 'ok') {
  app.flash = text;
  app.flashTone = tone;
  app.flashUntil = Date.now() + 2500;
}

function activeFlash() {
  if (app.flash && Date.now() > app.flashUntil) app.flash = null;
  return app.flash;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function syncCanvasSize() {
  const { videoWidth, videoHeight } = dom.video;
  if (!videoWidth) return false;
  if (dom.overlay.width !== videoWidth || dom.overlay.height !== videoHeight) {
    dom.overlay.width = videoWidth;
    dom.overlay.height = videoHeight;
    if (app.calibration && app.frameSize) {
      app.scale = videoWidth / app.frameSize.width;
      const scaleMatrix = [app.scale, 0, 0, 0, app.scale, 0, 0, 0, 1];
      const boardToImage = multiply(scaleMatrix, app.calibration.boardToImage);
      app.view = { boardToImage, imageToBoard: invert(boardToImage) };
    }
  }
  return true;
}

function drawOverlay() {
  const canvas = dom.overlay;
  if (!canvas.width || !canvas.height) return;
  const ctx = canvas.getContext('2d');
  const scale = canvas.width / 480;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!app.view) return;

  drawBoardGrid(ctx, app.view, scale);

  for (const t of visibleThrows()) {
    if (!t.board) continue;
    const [x, y] = applyHomography(app.view.boardToImage, t.board);
    if (!Number.isFinite(x)) continue;
    drawMarker(ctx, x, y, `${t.label}${t.uncertain ? ' ?' : ''}`, {
      color: t.uncertain ? '#ffb443' : '#edf0f7',
      scale
    });
  }
}

function render() {
  const s = app.state;
  if (!s) return;

  document.querySelector('.app').dataset.current = String(s.winner ?? s.current);

  s.config.players.forEach((name, i) => {
    const card = dom.players[i];
    card.querySelector('.player-name').textContent = name;
    const scoreNode = card.querySelector('.player-score');
    const value = String(s.scores[i]);
    if (scoreNode.textContent !== value) {
      scoreNode.textContent = value;
      scoreNode.classList.remove('tick');
      void scoreNode.offsetWidth;   // forces the animation to restart
      scoreNode.classList.add('tick');
    }
    // The darts of this turn are on the tiles, so under the score we show
    // what actually helps at the board: the way to zero.
    const checkout = !s.finished && s.current === i
      ? suggestCheckout(s.scores[i], s.dartsLeft, s.config.doubleOut)
      : null;
    card.querySelector('.player-darts').textContent = checkout
      ? t('stat.checkout', { path: checkout.join(' ') })
      : t('stat.average', { value: turnAverage(s.stats[i]).toFixed(1) });
    card.classList.toggle('active', !s.finished && s.current === i);
    card.classList.toggle('winner', s.winner === i);
  });

  if (s.finished) {
    setStatus('ok', t('status.winner', { name: s.config.players[s.winner] }));
    announceWinner(s.winner);
  } else {
    // Fixing the last dart can undo a win, and then the end-of-game dialog
    // must not stay on screen.
    app.announcedWinner = null;
    if (dom.winDialog.open) dom.winDialog.close();

    if (activeFlash()) {
      setStatus('ok', activeFlash());
    } else if (app.awaitingPull) {
      setStatus('warn', t('status.pullShort', { name: s.config.players[s.current] }));
    } else if (!isCameraMode()) {
      setStatus('idle', manualHint());
    } else if (!app.calibration && app.status) {
      setStatus(app.status.tone, app.status.text);
    }
  }

  renderThrows();
  refreshKeypad();

  // Once the game is over there is nobody to hand the turn to, so the big button
  // starts a new game, also when the end-of-game dialog was closed without a rematch.
  dom.turnButton.textContent = s.finished
    ? t('turn.newGame')
    : app.awaitingPull
      ? t('turn.resume', { name: s.config.players[s.current] })
      : t('turn.next');
  // With manual entry, a turn without a single dart has nothing to hand over;
  // tapping "Next player" would then skip the other player's turn.
  dom.turnButton.disabled = !s.finished && !isCameraMode() && !app.awaitingPull && !s.turnDarts.length;
  dom.turnButton.classList.toggle('primary', s.finished || app.awaitingPull);

  $('btnUndo').disabled = !app.events.length;
  $('btnCalibrate').disabled = !isRunning() || app.calibrating;

  dom.calibrationNote.textContent = app.quality
    ? t('calib.note', {
      match: (app.quality.match * 100).toFixed(0),
      radius: Math.round(app.quality.radius),
      squash: (app.quality.squash * 100).toFixed(0)
    })
    : t('calib.none');

  drawOverlay();
}

function renderThrows() {
  const darts = visibleThrows();
  dom.throws.innerHTML = '';

  for (let slot = 0; slot < DARTS_PER_TURN; slot++) {
    const dart = darts[slot];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'throw-slot'
      + (dart ? ' filled' : '')
      + (dart && dart.uncertain ? ' uncertain' : '')
      + (dart && dart.index === app.lastEntry ? ' last' : '');
    button.disabled = !dart;

    if (dart) {
      button.innerHTML = `<span class="label">${dart.label}${dart.uncertain ? ' ?' : ''}</span>`
        + `<span class="points">${t('slot.points', { points: dart.points })}</span>`;
      button.addEventListener('click', () => openEditor(dart.index));
    } else {
      button.innerHTML = `<span class="label">–</span><span class="points">${t('slot.empty', { n: slot + 1 })}</span>`;
    }
    dom.throws.appendChild(button);
  }
}

/**
 * End-of-game dialog. The figures (darts, average, best turn) are already
 * computed on every throw; here they finally get somewhere to show.
 * The winner's colour comes from `data-winner`, just like their tile's colour.
 */
function announceWinner(index) {
  if (app.announcedWinner === index) return;
  app.announcedWinner = index;
  const s = app.state;
  const stats = s.stats[index];

  dom.winDialog.dataset.winner = String(index);
  $('winTitle').textContent = s.config.players[index];
  dom.winText.textContent = t('win.line', { start: s.config.startScore });

  const figures = [
    [stats.darts, t('win.darts')],
    [turnAverage(stats).toFixed(1), t('win.average')],
    [stats.bestTurn, t('win.best')]
  ];
  $('winStats').innerHTML = figures
    .map(([value, label]) => `<div><dt>${value}</dt><dd>${label}</dd></div>`)
    .join('');

  if (typeof dom.winDialog.showModal === 'function') dom.winDialog.showModal();
}

function showStageMessage(html) {
  dom.stageMsg.innerHTML = html;
  dom.stageMsg.classList.remove('hidden');
}

function hideStageMessage() {
  dom.stageMsg.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Event handling
// ---------------------------------------------------------------------------

/** A tap on the camera image: a fix when the detector missed something. */
function canvasPointFromEvent(event) {
  const canvas = dom.overlay;
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const x = (event.clientX - rect.left - (rect.width - canvas.width * scale) / 2) / scale;
  const y = (event.clientY - rect.top - (rect.height - canvas.height * scale) / 2) / scale;
  if (x < 0 || y < 0 || x > canvas.width || y > canvas.height) return null;
  return { x, y };
}

/**
 * How throws are entered: camera (automatic), drawn board or number keypad.
 * Outside camera mode the image analysis is paused and the camera itself is
 * off; otherwise it would keep adding hits in the background.
 */
function setMode(mode) {
  const previous = app.config.mode || 'camera';
  app.config = { ...app.config, mode };
  app.lastEntry = null;
  app.keypadRing = 'single';

  $('cameraView').classList.toggle('hidden', mode !== 'camera');
  $('boardView').classList.toggle('hidden', mode !== 'board');
  $('keypadView').classList.toggle('hidden', mode !== 'keypad');
  $('modes').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));

  if (mode === 'camera' && previous !== 'camera') {
    if (cameraSupported()) enableCamera();
  } else if (mode !== 'camera' && previous === 'camera') {
    stopCamera();
    if (app.timer) clearInterval(app.timer);
    app.timer = null;
    app.calibration = null;
    app.view = null;
    // Outside camera mode there is nothing to pull from the board; the turn is simply open.
    app.awaitingPull = false;
    setStatus('idle', manualHint());
  }

  storage.saveGame(app.config, app.events);
  render();
}

/**
 * Number keypad. A number scores a single, so most throws take one tap. For a
 * double or triple, arm ×2 or ×3 first, then tap the number. The multiplier
 * applies to one dart and switches itself off, so there is no mode to forget;
 * tapping it again before a number also switches it off.
 */
function buildKeypad() {
  const numbers = $('keypadNumbers');
  numbers.innerHTML = '';
  for (let sector = 1; sector <= 20; sector++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(sector);
    button.dataset.sector = String(sector);
    numbers.appendChild(button);
  }

  numbers.addEventListener('click', (event) => {
    const sector = Number(event.target.dataset.sector);
    if (!sector) return;
    keypadThrow(scoreFor(sector, app.keypadRing));
  });

  $('keypadMult').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || !button.dataset.ring) return;
    app.keypadRing = app.keypadRing === button.dataset.ring ? 'single' : button.dataset.ring;
    refreshKeypad();
    if (navigator.vibrate) navigator.vibrate(25);
  });

  document.querySelector('.keypad-special').addEventListener('click', (event) => {
    const special = event.target.dataset.special;
    if (!special) return;
    keypadThrow(scoreFor(special === 'bull' ? 50 : special === 'outerBull' ? 25 : 0, special));
  });
}

/** Every keypad dart uses up the armed multiplier, including bull, 25 and a miss. */
function keypadThrow(score) {
  app.keypadRing = 'single';
  if (app.awaitingPull) app.awaitingPull = false;
  if (addThrow(score, 'keypad')) app.lastEntry = app.events.length - 1;
  render();
}

/** The armed multiplier lights up and waits for a number. */
function refreshKeypad() {
  for (const button of $('keypadMult').querySelectorAll('button')) {
    const ring = button.dataset.ring;
    const armed = app.keypadRing === ring;
    button.classList.toggle('on', armed);
    button.innerHTML = `<span class="mult-key">${ring === 'double' ? '×2' : '×3'} `
      + `${ring === 'double' ? t('keypad.double') : t('keypad.triple')}</span>`
      + `<span class="mult-target">${armed ? t('keypad.tapNumber') : t('keypad.thenNumber')}</span>`;
  }
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    if (event.target.id === 'btnStartCamera') enableCamera();
  });

  dom.overlay.addEventListener('click', (event) => {
    if (!app.view || app.state.finished) return;
    const point = canvasPointFromEvent(event);
    if (!point) return;
    const score = scoreAtImage(app.view, point.x, point.y);
    if (score.ring === 'out' && score.radius > 1.3) return; // accidental tap next to the board
    if (app.awaitingPull) app.awaitingPull = false;
    addThrow(score, 'manual');
  });

  dom.turnButton.addEventListener('click', () => {
    if (app.state.finished) {
      newGame();
      return;
    }
    app.lastEntry = null;
    if (app.awaitingPull) resumeAfterPull();
    else if (app.state.turnDarts.length) endTurn();
    else if (isCameraMode()) resumeAfterPull(); // nothing landed yet; just refresh the background
  });

  // Opening "Another bed" moves the number grid under a cursor that has not
  // moved, so the browser immediately shows it as hovered although nobody
  // hovered it. Block taps for a moment, until the cursor really moves
  // (or a short time passes; on touch screens the mouse never moves).
  dom.editPicker.addEventListener('toggle', () => {
    if (!dom.editPicker.open) return;
    const picker = dom.editPicker.querySelector('.picker');
    picker.style.pointerEvents = 'none';
    const release = () => { picker.style.pointerEvents = ''; };
    window.addEventListener('mousemove', release, { once: true });
    setTimeout(release, 400);
  });

  $('btnCloseEdit').addEventListener('click', () => dom.editDialog.close());
  $('btnDeleteThrow').addEventListener('click', () => {
    if (app.editing !== null) deleteThrow(app.editing);
    dom.editDialog.close();
  });
  dom.editDialog.addEventListener('close', () => { app.editing = null; });

  document.querySelectorAll('.language-switch [data-lang]').forEach((button) => {
    button.addEventListener('click', () => pickLanguage(button.dataset.lang));
  });
  $('btnTheme').addEventListener('click', () => {
    const choices = ['system', 'light', 'dark'];
    const next = choices[(choices.indexOf(window.ocheTheme.get()) + 1) % choices.length];
    window.ocheTheme.set(next);
    syncHeaderControls();
  });

  $('btnUndo').addEventListener('click', undo);
  $('btnCalibrate').addEventListener('click', () => calibrate());
  $('btnMenu').addEventListener('click', openMenu);

  dom.menuDialog.addEventListener('close', applySettings);
  $('btnNewGame').addEventListener('click', () => {
    applySettings();
    newGame();
    dom.menuDialog.close();
  });
  $('btnSkip').addEventListener('click', () => {
    endTurn({ force: true });
    dom.menuDialog.close();
  });
  $('modes').addEventListener('click', (event) => {
    const mode = event.target.dataset.mode;
    if (mode && mode !== (app.config.mode || 'camera')) setMode(mode);
  });
  $('btnRematch').addEventListener('click', () => {
    dom.winDialog.close();
    newGame();
  });
  // Leaving the end-of-game dialog without a rematch, in case the last dart
  // was wrong and still needs fixing.
  $('btnCloseWin').addEventListener('click', () => dom.winDialog.close());

  window.addEventListener('resize', () => {
    syncCanvasSize();
    drawOverlay();
  });
  window.addEventListener('pagehide', stopCamera);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopCamera();
      if (app.timer) clearInterval(app.timer);
      app.timer = null;
    }
  });
}

// ---------------------------------------------------------------------------
// Settings and header controls
// ---------------------------------------------------------------------------

function syncHeaderControls() {
  document.querySelectorAll('.language-switch [data-lang]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.lang === getLanguage()));
  });
  const theme = window.ocheTheme.get();
  const button = $('btnTheme');
  const label = `${t('settings.theme')}: ${t(`settings.theme.${theme}`)}`;
  button.dataset.themeChoice = theme;
  button.setAttribute('aria-label', label);
  button.title = label;
}

/** Names nobody changed follow the interface language. */
function localizeDefaultNames(names) {
  return names.map((name, i) => (isDefaultPlayerName(name, i) ? defaultPlayerName(i) : name));
}

function applyLanguage(code) {
  setLanguage(code);
  storage.saveLanguage(code);
  applyStaticTranslations();
  syncHeaderControls();
  refreshMenuLabels();
  app.flash = null;   // the message from a moment ago is still in the old language

  app.config = { ...app.config, players: localizeDefaultNames(app.config.players) };
}

/**
 * Language change from the header. Preserve names being edited if the settings
 * dialog is open; otherwise use the saved game names.
 */
function pickLanguage(code) {
  if (code === getLanguage()) return;
  const names = dom.menuDialog.open
    ? [$('setName0').value.trim(), $('setName1').value.trim()]
    : app.config.players;
  applyLanguage(code);

  const localized = localizeDefaultNames(names.map((name, i) => name || defaultPlayerName(i)));
  $('setName0').value = localized[0];
  $('setName1').value = localized[1];
  app.config = { ...app.config, players: localized };
  recompute();
}

/** Labels of the name fields: the only ones in the settings dialog that cannot live in the HTML. */
function refreshMenuLabels() {
  $('setName0Label').textContent = t('settings.player', { n: 1 });
  $('setName1Label').textContent = t('settings.player', { n: 2 });
}

function openMenu() {
  $('setName0').value = app.config.players[0];
  $('setName1').value = app.config.players[1];
  $('setStart').value = String(app.config.startScore ?? DEFAULT_CONFIG.startScore);
  $('setDoubleOut').checked = Boolean(app.config.doubleOut);
  $('setMinGap').value = String(app.config.minGapMm ?? DEFAULT_CONFIG.minGapMm);
  dom.menuDialog.showModal();
  // Focus goes to the game picker, not a name field; otherwise the phone
  // slides the keyboard up straight away, although people usually come here for something else.
  $('setStart').focus();
}

function applySettings() {
  const names = localizeDefaultNames([
    $('setName0').value.trim() || defaultPlayerName(0),
    $('setName1').value.trim() || defaultPlayerName(1)
  ]);
  const minGapMm = Number($('setMinGap').value) || DEFAULT_CONFIG.minGapMm;
  const startScore = Number($('setStart').value) || DEFAULT_CONFIG.startScore;
  const doubleOut = $('setDoubleOut').checked;
  const rulesChanged = startScore !== app.config.startScore || doubleOut !== Boolean(app.config.doubleOut);

  app.config = { ...app.config, players: names, minGapMm, startScore, doubleOut };

  // Rules cannot change mid-leg: rescoring old throws under new rules
  // would rewrite what has already happened.
  if (rulesChanged && app.events.length) newGame();
  else recompute();
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

function init() {
  $('appVersion').textContent = APP_VERSION;
  setLanguage(storage.loadLanguage() || DEFAULT_LANGUAGE);
  applyStaticTranslations();
  syncHeaderControls();

  const saved = storage.loadGame();
  if (saved) {
    app.config = { ...DEFAULT_CONFIG, ...saved.config };
    app.events = saved.throws;
  }
  app.config = { ...app.config, players: localizeDefaultNames(app.config.players) };

  app.boardApi = renderBoard(dom.boardSvg, (score) => {
    if (app.state.finished) return;
    if (app.awaitingPull) app.awaitingPull = false;
    addThrow(score, 'manual');
  });

  buildPicker();
  buildKeypad();
  refreshMenuLabels();
  bindEvents();
  recompute();
  setMode(app.config.mode || 'camera');

  if (!cameraSupported()) {
    showStageMessage(`<p>${t('stage.noCamera')}</p>`);
  }
}

/** Registration for installing from Chrome and playing offline. */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (location.protocol !== 'https:' && !local) return;
  const register = () => navigator.serviceWorker.register('sw.js').catch(() => {
    /* no service worker only means no offline mode; the game still works */
  });
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register);
}

/** The app was launched from a home-screen icon, not a browser tab. */
function isInstalled() {
  return ['fullscreen', 'standalone', 'minimal-ui'].some((mode) => matchMedia(`(display-mode: ${mode})`).matches)
    || navigator.standalone === true;
}

/**
 * The "Install app" button in the settings. Chrome also offers installation
 * itself (a bar at the bottom, the ⋮ menu), but it is easy to miss; this one
 * is always at hand while installation is possible.
 */
function setupInstall() {
  const box = $('installBox');
  let prompt = window.__installPrompt || null;
  const refresh = () => { box.hidden = !prompt || isInstalled(); };

  window.addEventListener('beforeinstallprompt', (event) => {
    prompt = event;
    refresh();
  });
  window.addEventListener('appinstalled', () => {
    prompt = null;
    refresh();
  });
  $('btnInstall').addEventListener('click', async () => {
    if (!prompt) return;
    const pending = prompt;
    prompt = null; // the event can only be used once
    refresh();
    try {
      await pending.prompt();
      const choice = await pending.userChoice;
      if (choice && choice.outcome === 'accepted') dom.menuDialog.close();
    } catch {
      /* declined, or a browser without this feature: the button simply disappears */
    }
  });
  refresh();
}

init();
setupInstall();
registerServiceWorker();

// State exposed for automated tests.
window.__darts = app;
