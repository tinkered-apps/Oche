// An axe scan of every view in both themes. The desktop and mobile projects
// cover both layouts.

import { AxeBuilder } from '@axe-core/playwright';
import { test, expect } from './fixtures.js';

for (const theme of ['light', 'dark']) {
  test(`axe finds no accessibility violations in the ${theme} theme`, async ({ page }) => {
    // Reduced motion ends transitions at once, so contrast is measured on the final colours.
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    // Every view is scanned before the assertion, so one run lists all violations.
    const found = [];
    const scan = async (view) => {
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const { violations } = await new AxeBuilder({ page }).analyze();
      for (const violation of violations) {
        for (const node of violation.nodes) found.push(`${view}: ${violation.id}: ${node.target.join(' ')}`);
      }
    };

    await page.goto('/');
    await expect(page.locator('#appVersion')).not.toBeEmpty();
    await scan('camera');
    await page.locator('[data-mode="keypad"]').click();
    await page.locator('#keypadMult [data-ring="triple"]').click();
    await page.locator('#keypadNumbers [data-sector="20"]').click();
    await scan('keypad');
    await page.locator('[data-mode="board"]').click();
    await expect(page.locator('#boardSvg')).toBeVisible();
    await scan('board');
    await page.locator('#btnMenu').click();
    await expect(page.locator('#menuDialog')).toBeVisible();
    await scan('settings');
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Data and privacy');
    await scan('privacy');
    expect(found).toEqual([]);
  });
}
