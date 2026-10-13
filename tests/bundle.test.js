// The bundle for a page opened from disk must keep up with the modules; otherwise
// double-clicking index.html would run an old version of the app.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildBundle, BUNDLE_PATH } from '../scripts/bundle.js';

test('js/oche.bundle.js matches the modules (npm run bundle)', () => {
  const current = fs.readFileSync(BUNDLE_PATH, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(current, buildBundle());
});

test('the bundle is a valid plain script', () => {
  assert.doesNotThrow(() => new vm.Script(buildBundle()));
});
