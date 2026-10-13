// Every test fails on a console error or an uncaught exception, and warns
// about any request to another origin: the app is meant to make none.

import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  page: async ({ page, baseURL }, use, testInfo) => {
    const errors = [];
    const origin = new URL(baseURL).origin;
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) {
        const note = `request to another origin: ${request.url()}`;
        console.warn(`[${testInfo.project.name}] ${note}`);
        testInfo.annotations.push({ type: 'warning', description: note });
      }
    });

    await use(page);

    expect(errors, 'console errors').toEqual([]);
  }
});

export { expect };
