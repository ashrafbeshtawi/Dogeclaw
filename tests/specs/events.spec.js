const { test, expect } = require('@playwright/test');
const { openAdminTab } = require('../helpers/ui.js');
const { psql } = require('../helpers/db.js');

// Insert event_logs rows directly via psql — there is no POST endpoint and
// genuinely firing crons + telegram audio in CI would be flaky. All rows
// inserted by tests use a ref_id starting with `pw-` so cleanup is scoped.
const TEST_REF_PREFIX = 'pw-evt';

function insertEvent({ kind, status = 'success', input = '', output = '', refId, error = null, durationMs = 100, meta = {} }) {
  const ref = refId || `${TEST_REF_PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const sql = `INSERT INTO event_logs (kind, ref_id, status, input, output, error, duration_ms, meta)
               VALUES ('${kind}', '${ref}', '${status}',
                       $$${input}$$, $$${output}$$, ${error ? `$$${error}$$` : 'NULL'},
                       ${durationMs}, '${JSON.stringify(meta)}'::jsonb)
               RETURNING id;`;
  return psql(sql).trim();
}

test.describe('event log admin page', () => {
  // The events table is operational/disposable — wipe it between tests so the
  // exact-row-count assertions below don't get false positives from earlier
  // tests or background cron firings.
  test.beforeEach(async () => {
    psql('DELETE FROM event_logs;');
  });

  test('renders rows and the empty state', async ({ page }) => {
    await openAdminTab(page, 'events');
    await expect(page.locator('#eventsTable')).toContainText('No events yet');

    insertEvent({ kind: 'cron_run', refId: '1', input: 'do a thing', output: 'I did it' });
    insertEvent({ kind: 'cron_run', refId: '2', input: 'another',     output: 'and another' });

    await page.click('button:has-text("Refresh")');
    await expect(page.locator('#eventsTable tr')).toHaveCount(2);
    await expect(page.locator('#eventsTable')).toContainText('cron_run');
  });

  test('kind filter scopes to cron_run', async ({ page }) => {
    insertEvent({ kind: 'cron_run', input: 'a', output: 'a-out' });
    insertEvent({ kind: 'cron_run', input: 'b', output: 'b-out' });

    await openAdminTab(page, 'events');
    await page.selectOption('#eventsKindFilter', 'cron_run');
    await expect(page.locator('#eventsTable tr')).toHaveCount(2);
  });

  test('row click opens the detail modal with input/output', async ({ page }) => {
    insertEvent({ kind: 'cron_run', input: 'morning ping', output: 'all systems normal' });
    await openAdminTab(page, 'events');
    // showTab fires loadEvents asynchronously; target the seeded row by text
    // so playwright auto-waits for it instead of clicking the "No events yet"
    // placeholder. The preview column renders output, not input — so filter
    // by output text.
    const row = page.locator('#eventsTable tr', { hasText: 'all systems normal' });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.locator('#eventModal')).toHaveClass(/open/);
    await expect(page.locator('#eventModalBody')).toContainText('morning ping');
    await expect(page.locator('#eventModalBody')).toContainText('all systems normal');
  });

  test('per-row delete removes a single entry', async ({ page }) => {
    insertEvent({ kind: 'cron_run', input: 'keep', output: 'keep' });
    insertEvent({ kind: 'cron_run', input: 'drop', output: 'drop' });
    await openAdminTab(page, 'events');
    await expect(page.locator('#eventsTable tr')).toHaveCount(2);
    page.on('dialog', d => d.accept());
    await page.locator('#eventsTable tr', { hasText: 'drop' }).locator('button.danger').click();
    await expect(page.locator('#eventsTable tr')).toHaveCount(1);
    await expect(page.locator('#eventsTable')).toContainText('keep');
  });

  test('"Clear filtered" wipes the matching rows', async ({ page }) => {
    insertEvent({ kind: 'cron_run', input: 'a', output: 'a' });
    insertEvent({ kind: 'cron_run', input: 'b', output: 'b' });

    await openAdminTab(page, 'events');
    await page.selectOption('#eventsKindFilter', 'cron_run');
    page.on('dialog', d => d.accept());
    await page.click('button:has-text("Clear filtered")');
    await expect(page.locator('#eventsTable')).toContainText('No events yet');
  });
});

test.describe('event log retention setting', () => {
  test('settings tab shows the retention input and persists changes', async ({ page, request }) => {
    const before = await (await request.get('/api/settings')).json();
    const original = before.event_log_retention_days != null ? before.event_log_retention_days : 14;
    const target = original === 7 ? 21 : 7;

    try {
      await openAdminTab(page, 'settings');
      await expect(page.locator('#settingEventRetention')).toBeVisible();
      await page.fill('#settingEventRetention', String(target));
      page.on('dialog', d => d.accept());
      // The retention row has its own Save button.
      await page.locator('#settingEventRetention').locator('xpath=ancestor::tr').locator('button:has-text("Save")').click();

      await expect.poll(async () => {
        const s = await (await request.get('/api/settings')).json();
        return s.event_log_retention_days;
      }).toBe(target);
    } finally {
      await request.put('/api/settings/event_log_retention_days', { data: { value: original } });
    }
  });
});
