// The CSP allows script-src 'self' only, so an inline script or event-handler
// attribute would be blocked in production. The privacy page stays out of
// search results.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');

test('the pages have no inline scripts or event-handler attributes', () => {
  for (const page of ['index.html', 'privacy.html']) {
    const html = read(page);
    assert.equal(html.match(/<script(?![^>]*\ssrc=)[^>]*>/g), null, `${page}: move inline scripts to files`);
    assert.equal(html.match(/<[^>]+\son[a-z]+\s*=/gi), null, `${page}: use addEventListener instead of on* attributes`);
  }
});

test('the privacy page asks search engines not to index it', () => {
  assert.match(read('privacy.html'), /<meta name="robots" content="noindex">/);
  const headers = read('_headers');
  for (const path of ['/privacy', '/privacy.html']) {
    assert.match(headers, new RegExp(`^${path.replace('.', '\\.')}\\r?\\n\\s+X-Robots-Tag: noindex`, 'm'), path);
  }
});

test('the footer links to the privacy page by file name', () => {
  assert.match(read('index.html'), /<a href="privacy\.html" data-i18n="footer\.privacy">/);
});
