// The admin's logic used to live in an 811-line inline <script>, where it was
// unreachable by any tool: no linting, and the only way to exercise a helper
// was to drive the whole UI. Now that it is a served file, the pure helpers
// can be called directly with crafted inputs — no clicking, no fixtures.
const { test, expect } = require('@playwright/test');

test.describe('admin script extraction', () => {
  const MODULES = ['main', 'store', 'models', 'agents', 'skills', 'channels', 'mcp', 'search', 'crons', 'events', 'settings'];

  test('admin.html carries no inline logic and loads the module entry', async ({ request }) => {
    const html = await (await request.get('/admin')).text();
    expect(html).toContain('<script type="module" src="/static/admin/main.js"></script>');
    // no <script> with a body — the only script tag is the src one
    expect(html).not.toMatch(/<script>[\s\S]*?<\/script>/);
  });

  for (const name of MODULES) {
    test(`admin/${name}.js is served`, async ({ request }) => {
      const res = await request.get(`/static/admin/${name}.js`);
      expect(res.ok()).toBeTruthy();
      expect((await res.text()).length).toBeGreaterThan(50);
    });
  }

  test('no module is oversized', async ({ request }) => {
    // The point of the split: the old single script was 810 lines. If one of
    // these creeps back past ~250 it has become the thing we broke up.
    for (const name of MODULES) {
      const body = await (await request.get(`/static/admin/${name}.js`)).text();
      const lines = body.split('\n').length;
      expect(lines, `admin/${name}.js is ${lines} lines`).toBeLessThan(250);
    }
  });

  test('the page loads with no console errors and boots its state', async ({ page }) => {
    // A module that fails to parse or resolve an import dies silently as far
    // as the DOM is concerned — the tab just never renders. Catch it directly.
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(e.message));

    await page.goto('/admin');
    await page.waitForFunction(() => window.state && Array.isArray(window.state.models));
    expect(errors).toEqual([]);
  });

  test('every inline handler the markup calls is reachable in global scope', async ({ page, request }) => {
    // Module top-level functions are NOT globals. Each one referenced from an
    // onclick/onchange attribute has to be republished on window, or the
    // button silently does nothing.
    const html = await (await request.get('/admin')).text();
    const fromMarkup = [...html.matchAll(/on(?:click|change|input)="([a-zA-Z_][\w]*)\s*\(/g)].map(m => m[1]);
    expect(fromMarkup.length).toBeGreaterThan(20);

    await page.goto('/admin');
    await page.waitForFunction(() => !!window.showTab);
    const missing = await page.evaluate(
      names => names.filter(n => typeof window[n] !== 'function'),
      [...new Set(fromMarkup)],
    );
    expect(missing).toEqual([]);
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
