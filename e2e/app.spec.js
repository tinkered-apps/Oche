import { test, expect } from './fixtures.js';

const score = (page, player) => page.locator(`#player${player} .player-score`);

async function openSettings(page) {
  await page.locator('#btnMenu').click();
  await expect(page.locator('#menuDialog')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#appVersion')).not.toBeEmpty();
});

test('the server sends the security headers', async ({ page }) => {
  const response = await page.request.get('/');
  const headers = response.headers();
  expect(headers['content-security-policy']).toContain("default-src 'self'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['permissions-policy']).toContain('camera=(self)');
});

test('keypad: a triple scores, undo takes it back', async ({ page }) => {
  await page.locator('[data-mode="keypad"]').click();
  await page.locator('#keypadMult [data-ring="triple"]').click();
  await page.locator('#keypadNumbers [data-sector="20"]').click();

  await expect(score(page, 0)).toHaveText('241');
  await expect(page.locator('.throw-slot.filled .label')).toHaveText('T20');

  await page.locator('#btnUndo').click();
  await expect(score(page, 0)).toHaveText('301');
});

test('board: tapping the bull scores 50', async ({ page }) => {
  await page.locator('[data-mode="board"]').click();
  const board = page.locator('#boardSvg');
  const box = await board.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await expect(score(page, 0)).toHaveText('251');
});

test('a 101 leg is played to the end and a rematch starts over', async ({ page }) => {
  await openSettings(page);
  await page.locator('#setStart').selectOption('101');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(score(page, 0)).toHaveText('101');

  await page.locator('[data-mode="keypad"]').click();
  await page.locator('#keypadMult [data-ring="triple"]').click();
  await page.locator('#keypadNumbers [data-sector="20"]').click();
  await page.locator('#keypadNumbers [data-sector="1"]').click();
  await page.locator('#keypadMult [data-ring="double"]').click();
  await page.locator('#keypadNumbers [data-sector="20"]').click();

  await expect(page.locator('#winDialog')).toBeVisible();
  await expect(page.locator('#winTitle')).toHaveText('Player 1');
  await page.locator('#btnRematch').click();
  await expect(score(page, 0)).toHaveText('101');
});

test('theme: an explicit choice wins over the device and survives a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.locator('#btnTheme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('#btnTheme')).toHaveAttribute('aria-label', 'Theme: Light');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.locator('#btnTheme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#btnTheme')).toHaveAttribute('aria-label', 'Theme: Dark');
  await page.locator('#btnTheme').click();
  await expect(page.locator('#btnTheme')).toHaveAttribute('aria-label', 'Theme: Match the device');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('language: Polish switches the interface at once', async ({ page }) => {
  await openSettings(page);
  await page.locator('#setName0').fill('Kuba');
  await page.getByRole('button', { name: 'Done' }).click();

  await page.locator('[data-lang="pl"]').click();
  await expect(page.getByRole('button', { name: 'Kamera' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
  await expect(page.locator('[data-lang="pl"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#player0 .player-name')).toHaveText('Kuba');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
  await openSettings(page);
  await expect(page.locator('#setLang')).toHaveCount(0);
  await expect(page.locator('#setTheme')).toHaveCount(0);
});

test('footer credit carries the version and both links', async ({ page }) => {
  const credit = page.locator('footer.credit');
  await expect(credit).toContainText(/Oche v\d\.\d\d by Kuba/);
  await expect(credit.getByRole('link', { name: 'Kuba' })).toHaveAttribute('href', 'mailto:kuba@tinkered.app');
  await expect(credit.getByRole('link', { name: 'tinkered.app' })).toHaveAttribute('href', 'https://tinkered.app');
  await expect(credit.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', 'privacy.html');
});

test('the footer opens the privacy page in the app language, and it leads back', async ({ page }) => {
  await page.locator('[data-lang="pl"]').click();

  await page.locator('footer.credit').getByRole('link', { name: 'Prywatność' }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dane i prywatność');

  await page.getByRole('radio', { name: 'EN' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Data and privacy');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.getByRole('link', { name: 'Back to the game' }).click();
  await expect(page.locator('#appVersion')).not.toBeEmpty();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('the privacy page is sent with a noindex header', async ({ request }) => {
  const response = await request.get('/privacy');
  expect(response.headers()['x-robots-tag']).toBe('noindex');
});
