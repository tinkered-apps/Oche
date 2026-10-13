// One version number: APP_VERSION fills the footer, and the service worker's
// cache name carries the same number, so a release always replaces the cache.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');

test('APP_VERSION and the service worker CACHE carry the same version', () => {
  const app = read('js/app.js').match(/const APP_VERSION = '(\d+\.\d\d)';/);
  const sw = read('sw.js').match(/const CACHE = 'oche-v(\d+\.\d\d)';/);
  assert.ok(app, 'APP_VERSION in js/app.js has the form X.XX');
  assert.ok(sw, "CACHE in sw.js has the form 'oche-vX.XX'");
  assert.equal(sw[1], app[1]);
});

test('every file the service worker caches up front exists', () => {
  const list = read('sw.js').match(/const SHELL = \[([\s\S]*?)\];/)[1];
  for (const [, file] of list.matchAll(/'\.\/([^']*)'/g)) {
    if (file) assert.ok(fs.existsSync(new URL(`../public/${file}`, import.meta.url)), file);
  }
});
