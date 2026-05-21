const { test, expect } = require('@playwright/test');

// Auth tests need an unauthenticated browser context. Override the default
// storageState so cookies from global-setup don't leak in.
test.use({ storageState: { cookies: [], origins: [] } });

test('admin page redirects to /login when unauthenticated', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login$/);
});

test('invalid credentials show error', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name="user"]', 'admin');
  await page.fill('input[name="password"]', 'wrong-password');
  await page.click('button[type="submit"]');
  await expect(page.locator('#error')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('valid credentials redirect to chat', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name="user"]', 'admin');
  await page.fill('input[name="password"]', 'changeme');
  await Promise.all([
    page.waitForURL(/^http:\/\/localhost:3000\/?$/),
    page.click('button[type="submit"]'),
  ]);
});

test('logout clears auth and bounces back to login', async ({ page, request }) => {
  // Log in first
  await page.goto('/login');
  await page.fill('input[name="user"]', 'admin');
  await page.fill('input[name="password"]', 'changeme');
  await Promise.all([
    page.waitForURL(/^http:\/\/localhost:3000\/?$/),
    page.click('button[type="submit"]'),
  ]);

  // POST /api/logout from the page's context (uses its cookies)
  const res = await page.request.post('/api/logout');
  expect(res.ok()).toBeTruthy();

  // Admin should redirect to login now
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login$/);
});
