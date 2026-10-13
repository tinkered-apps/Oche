// A fresh install has to open every page without a network, by either URL.
// The other specs block service workers; this one needs the real one.

import fs from 'node:fs';
import { test, expect } from './fixtures.js';

test.use({ serviceWorkers: 'allow' });

test('a fresh install opens the game and the privacy page offline', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.locator('#appVersion')).not.toBeEmpty();

  // Wait for the worker to control this page and to finish filling the cache, then cut the network.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
  });
  const shell = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
    .match(/const SHELL = \[([\s\S]*?)\];/)[1].match(/'[^']+'/g);
  await expect.poll(
    () => page.evaluate(async () => {
      const [name] = await caches.keys();
      return name ? (await (await caches.open(name)).keys()).length : 0;
    }),
    { timeout: 15_000 }
  ).toBeGreaterThanOrEqual(shell.length);

  await context.setOffline(true);
  try {
    // The host redirects the .html forms to the clean URLs; offline, the worker has to map them.
    for (const url of ['/', '/index.html']) {
      await page.goto(url);
      await expect(page.locator('#appVersion'), url).not.toBeEmpty();
      await page.locator('[data-mode="keypad"]').click();
      await expect(page.locator('#keypadView'), url).toBeVisible();
    }
    for (const url of ['/privacy', '/privacy.html']) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 }), url).toHaveText('Data and privacy');
    }
  } finally {
    await context.setOffline(false);
  }
});
