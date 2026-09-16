// The admin's logic used to live in an 811-line inline <script>, where it was
// unreachable by any tool: no linting, and the only way to exercise a helper
// was to drive the whole UI. Now that it is a served file, the pure helpers
// can be called directly with crafted inputs — no clicking, no fixtures.
const { test, expect } = require('@playwright/test');

test.describe('admin script extraction', () => {
  test('admin.js is served and admin.html carries no inline logic', async ({ page, request }) => {
    const js = await request.get('/static/admin.js');
    expect(js.ok()).toBeTruthy();
    expect((await js.text()).length).toBeGreaterThan(1000);

    const html = await (await request.get('/admin')).text();
    expect(html).toContain('<script src="/static/admin.js"></script>');
    // no <script> with a body — the only script tag is the src one
    expect(html).not.toMatch(/<script>[\s\S]*?<\/script>/);
  });

  test('cronFailed counts only jobs that ran and did not report ok', async ({ page }) => {
    await page.goto('/admin');
    const verdicts = await page.evaluate(() => [
      cronFailed({ last_run_at: '2026-01-01T00:00:00Z', last_status: 'error' }),
      cronFailed({ last_run_at: '2026-01-01T00:00:00Z', last_status: 'ok' }),
      // never run is not a failure — the distinction the Failing tab depends on
      cronFailed({ last_run_at: null, last_status: null }),
      cronFailed({}),
    ]);
    expect(verdicts).toEqual([true, false, false, false]);
  });

  test('cronSortValue produces comparable keys per column', async ({ page }) => {
    await page.goto('/admin');
    const values = await page.evaluate(() => {
      const job = {
        id: 7, agent_name: 'Ops', prompt: 'Do The Thing', expression: '*/5 * * * *',
        enabled: true, last_run_at: '2026-01-02T03:04:05Z', chat_id: '99', channel_name: 'tg',
      };
      return {
        id: cronSortValue(job, 'id'),
        agent: cronSortValue(job, 'agent'),
        prompt: cronSortValue(job, 'prompt'),
        enabled: cronSortValue(job, 'enabled'),
        last: cronSortValue(job, 'last'),
        neverRun: cronSortValue({ ...job, last_run_at: null }, 'last'),
        target: cronSortValue(job, 'target'),
        unknown: cronSortValue(job, 'nope'),
      };
    });

    expect(values.id).toBe(7);
    // strings lower-cased so sorting is not case-sensitive
    expect(values.agent).toBe('ops');
    expect(values.prompt).toBe('do the thing');
    expect(values.enabled).toBe(1);
    expect(values.last).toBe(Date.parse('2026-01-02T03:04:05Z'));
    // a job that never ran sorts below every job that has
    expect(values.neverRun).toBe(0);
    expect(values.target).toContain('99');
    expect(values.unknown).toBe(0);
  });

  test('cronMatchesFilter searches across the fields it claims to', async ({ page }) => {
    await page.goto('/admin');
    const hits = await page.evaluate(() => {
      const job = {
        agent_name: 'Ops', prompt: 'send the report', description: 'daily digest',
        expression: '0 9 * * *', channel_name: 'alerts', chat_id: '748203222',
        session_id: 'tg-abc', timezone: 'Europe/Berlin',
      };
      return {
        empty: cronMatchesFilter(job, ''),
        byPrompt: cronMatchesFilter(job, 'report'),
        byDescription: cronMatchesFilter(job, 'digest'),
        byChatId: cronMatchesFilter(job, '748203222'),
        byTimezone: cronMatchesFilter(job, 'berlin'),
        miss: cronMatchesFilter(job, 'nothing-matches-this'),
      };
    });
    expect(hits).toEqual({
      empty: true, byPrompt: true, byDescription: true,
      byChatId: true, byTimezone: true, miss: false,
    });
  });
});
