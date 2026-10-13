// Saves the game state and settings in the browser's storage.

const GAME_KEY = 'darts301.game';
const LANG_KEY = 'darts301.lang';

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private browsing mode: we play without saving */
  }
}

export function loadGame() {
  const data = read(GAME_KEY);
  if (!data || !Array.isArray(data.throws) || !data.config) return null;
  return data;
}

export function saveGame(config, throwsList) {
  write(GAME_KEY, { config, throws: throwsList });
}

/**
 * The language is kept apart from the leg: it belongs to the person, not the
 * game, so it survives "New game" and clearing the saved state.
 */
export function loadLanguage() {
  const value = read(LANG_KEY);
  return typeof value === 'string' ? value : null;
}

export function saveLanguage(code) {
  write(LANG_KEY, code);
}
