const { test, expect } = require('@playwright/test');

/**
 * Smoke tests for the Citadel dashboard.
 *
 * These are intentionally lightweight — they confirm the app shell loads and
 * the unauthenticated user is funneled to a login surface. Expand with real
 * flows (login, server cards, live map) as fixtures/auth helpers are added.
 */

test('app shell loads without console errors', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  const response = await page.goto('/');
  expect(response, 'navigation should return a response').toBeTruthy();
  expect(response.status(), 'root should not 5xx').toBeLessThan(500);

  // The SPA mounts into #root.
  await expect(page.locator('#root')).toBeAttached();

  // No uncaught console errors on first paint.
  expect(errors, `console errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('unauthenticated visit reaches a login surface', async ({ page }) => {
  await page.goto('/');

  // Tolerant check: a password field, a "sign in"/"log in" control, or a
  // redirect to a /login route — whichever the build presents.
  const passwordField = page.locator('input[type="password"]');
  const loginText = page.getByText(/log\s?in|sign\s?in/i).first();

  await expect
    .poll(async () => {
      if (/login/i.test(page.url())) return true;
      if (await passwordField.count()) return true;
      if (await loginText.count()) return true;
      return false;
    }, { timeout: 15_000, message: 'expected a login surface for an unauthenticated user' })
    .toBe(true);
});
