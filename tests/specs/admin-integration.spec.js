// The admin is a React bundle: a module that fails to load or throws while
// rendering leaves the page blank rather than broken in an obvious way.
const { test, expect } = require('@playwright/test');

test.describe('admin page boot', () => {
  test('the page loads with no console errors and renders every tab', async ({ page }) => {
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(e.message));

    await page.goto('/admin');
    await expect(page.locator('#modelsTable')).toBeAttached();
    for (const tab of ['models', 'agents', 'skills', 'channels', 'mcp', 'search', 'crons', 'settings']) {
      await expect(page.locator(`#tab-${tab}`)).toBeAttached();
    }
    expect(errors).toEqual([]);
  });

  test('admin.html carries no inline logic', async ({ request }) => {
    const html = await (await request.get('/admin')).text();
    expect(html).toMatch(/<script type="module" crossorigin src="\/static\/assets\/admin\.js"><\/script>/);
    expect(html).not.toMatch(/<script>[\s\S]*?<\/script>/);
  });
});
