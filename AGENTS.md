# AGENTS.md

## Commands

```bash
npm install          # dev tools only (Wrangler, Playwright, axe, pinned); the app itself has no dependencies
npx playwright install chromium   # once, before the first npm run test:e2e
npm start            # wrangler dev at http://localhost:40460, with the production headers from public/_headers
npm test             # unit tests (node --test tests/*.test.js), including bundle freshness and the version check
npm run test:e2e     # Playwright, desktop and mobile Chromium, against npm start; includes an axe scan and an offline run
npm run bundle       # regenerate public/js/oche.bundle.js after editing anything in public/js/
npm run deploy       # npm test, then wrangler deploy to production (Worker oche, oche.tinkered.app)
```

- Run `npm test` after any change under `public/js/`; `bundle.test.js` fails the suite if `oche.bundle.js` is stale.
- Run `npm run test:e2e` before pushing UI changes. It is not part of the deploy gate: the Workers Builds image cannot start Chromium.
- The camera works only on `localhost` or over HTTPS. To test on a phone on the same network, run `npx wrangler dev --port 40460 --ip 0.0.0.0 --local-protocol https` and accept the self-signed certificate.
- `public/index.html` also runs straight from disk (`file://`) through the bundle; that is the only reason the bundle exists.

## Layout

```
public/              everything the site serves, and nothing else
├── index.html
├── privacy.html     data and privacy note (EN/PL), linked from the footer, noindex
├── _headers         security headers; Cloudflare applies it and does not serve it
├── css/style.css    dark tokens in :root, light tokens in :root[data-theme="light"]
├── fonts/           Oswald, self-hosted, with its licence (OFL.txt)
├── manifest.webmanifest, sw.js, icons/   install and offline mode
└── js/
    ├── boot.js       classic script in <head>: theme before first paint, install prompt, loads the app
    ├── privacy.js    classic script for privacy.html: theme and the language shared with the app
    ├── app.js        ties it together; holds APP_VERSION
    ├── geometry.js   board dimensions, scoring, homography algebra
    ├── autocalib.js  finding the board in the frame
    ├── detect.js     frame differencing, connected blobs, locating the tip
    ├── watcher.js    state machine: movement, occlusion, confirming darts
    ├── game.js       101 / 301 / 501 rules, busts, turns
    ├── camera.js     camera access and grabbing frames
    ├── overlay.js    board grid and markers over the image
    ├── board.js      the drawn SVG dartboard (Board mode)
    ├── i18n.js       interface text in English and Polish
    ├── storage.js    game and language saved in localStorage
    └── oche.bundle.js  generated from the modules above, for file://
tests/               unit tests (node --test), including a synthetic board generator
e2e/                 Playwright specs (app, a11y, offline); fixtures.js fails a test on console errors and warns on other-origin requests
scripts/bundle.js    builds public/js/oche.bundle.js
wrangler.jsonc       Cloudflare deployment (static assets from public/)
```

## Conventions

- **Only `public/` is served.** Keep repo-only files (docs, tests, scripts, config) outside it; anything placed in `public/` is published.
- **No runtime dependencies and no build step.** `public/index.html` loads plain ES modules from `public/js/` directly. Don't introduce a bundler, framework or package the app loads. Dev tools (Wrangler, Playwright) are pinned `devDependencies`.
- **`public/js/oche.bundle.js` is generated, never hand-edited.** Run `npm run bundle` after touching any module under `public/js/`. The generator (`scripts/bundle.js`) is a minimal hand-rolled bundler, not a real parser. It follows imports from `app.js` and only understands `import { a, b } from './x.js'`, `import * as x from './x.js'`, and `export function/const/let/class`. No default exports, no re-exports, no dynamic `import()`. `boot.js` is a classic script outside the bundle.
- **Game state is always recomputed from the event list**, never mutated in place. `public/js/game.js`'s `computeState(config, throwsList)` replays every throw from scratch on every change; "undo" is just popping the last event and recomputing. Keep new game-rule logic inside that pure-function shape.
- **All user-facing text goes through `public/js/i18n.js`.** Use `t('some.key', params)` and add a matching entry to *both* the `en` and `pl` dictionaries. Never hardcode UI strings in `app.js` or `index.html`. Two exceptions: the footer credit, which is fixed text (its "Privacy" link is translated), and `privacy.html`, which carries both languages as two articles.
- **Source comments and test names are in English.**
- **Theme.** Light, dark or the device's setting, chosen from the top-right header control. `boot.js` stores the choice and sets `data-theme` on `<html>` before the first paint; `app.js` talks to it through `window.ocheTheme`. Colours are CSS custom properties; add a new colour to both theme blocks in `style.css`.
- **Privacy page.** `public/privacy.html` starts from `C:\GIT Repos\.tinkered-legal\privacy-template.html`; the controller, hosting, email and rights sections come from that folder's `profil-wydawcy.md` and are not reworded here. Keep its table of what the app stores in the browser in step with `storage.js`, `boot.js` and `sw.js`. It is `noindex` in the page and in `_headers`. The legal audit and its project profile are in `.audyt-prawny/`.
- **Security headers live in `public/_headers`.** No inline scripts or event-handler attributes. One deviation from the baseline: `Permissions-Policy` allows `camera=(self)`, because Camera mode needs it.
- **Version.** `APP_VERSION` in `public/js/app.js` fills the footer, and `CACHE` in `public/sw.js` carries the same number (`oche-vX.XX`). Bump both on a user-visible release and whenever the cached file list or caching rules change; `tests/version.test.js` fails if they differ. Add new shell files to `SHELL` in `sw.js`. Pages are listed there by the URL the host serves (`./`, `./privacy`), never the `.html` form: the host redirects that form, and a cached redirect cannot open a page offline. The fetch handler maps an offline `.html` visit to the clean URL, and `tests/version.test.js` rejects `.html` entries.
- **No third-party requests, no analytics.** Fonts and images are self-hosted, and the footer's tinkered.app logo is inline SVG. The footer links (`mailto:` and `https://tinkered.app`) load nothing. Analytics would add a request to another origin and a privacy notice without answering an operational question. Adding any external service, analytics, accounts or ads changes the legal assessment and needs a re-check first.
- **Tests.** Unit tests use Node's built-in runner in `tests/*.test.js`. Browser flows use Playwright in `e2e/*.spec.js` and import `test` from `e2e/fixtures.js`. `playwright.config.js` blocks service workers; only `e2e/offline.spec.js` turns them on.

## Deployment

- Cloudflare Worker `oche` with static assets, at `oche.tinkered.app`. One environment: the app has no server data and no migrations.
- Deploy only with `npm run deploy`, which aborts if `npm test` fails.
- The repository is local only, with no remote yet, so Workers Builds is not connected and deploys are manual.
