// ESLint's recommended rules, run by `npm test`. The app has no build step, so
// this is the only thing that reads every file before it ships.

import js from '@eslint/js';
import globals from 'globals';

export default [
  // Generated from the modules by scripts/bundle.js; the modules themselves are linted.
  { ignores: ['node_modules/', 'test-results/', 'playwright-report/', '.wrangler/', 'public/js/oche.bundle.js'] },

  js.configs.recommended,
  // An unused name in `catch (error)` is harmless and the app ships those as written.
  { rules: { 'no-unused-vars': ['error', { caughtErrors: 'none' }] } },

  { files: ['public/**/*.js'], languageOptions: { sourceType: 'module', globals: globals.browser } },
  // Classic scripts loaded with a plain <script> tag.
  { files: ['public/js/boot.js', 'public/js/privacy.js'], languageOptions: { sourceType: 'script' } },
  { files: ['public/sw.js'], languageOptions: { sourceType: 'script', globals: globals.serviceworker } },

  { files: ['tests/**', 'scripts/**', '*.js', '*.mjs'], languageOptions: { globals: globals.node } },
  // Playwright specs run in Node and hand callbacks to the page.
  { files: ['e2e/**'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
];
