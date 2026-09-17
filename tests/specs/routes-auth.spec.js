// Auth is now applied once where the routers mount, instead of being repeated
// on each of the 46 route registrations. That is a real behavior change to a
// security boundary: if a router were ever mounted outside the guarded
// app.use, its routes would silently become public and every existing spec
// would still pass, because they all run authenticated.
//
// So: hit every resource anonymously and require a rejection.
const { test, expect, request: apiRequest } = require('@playwright/test');

const BASE = process.env.DOGECLAW_TEST_URL || 'http://localhost:3000';

// One representative read per router, plus a write, plus a nested path.
const GUARDED = [
  ['GET', '/api/sessions'],
  ['GET', '/api/models'],
  ['GET', '/api/agents'],
  ['GET', '/api/skills'],
  ['GET', '/api/channels'],
  ['GET', '/api/telegram/commands'],
  ['GET', '/api/mcp'],
  ['GET', '/api/cron-jobs'],
  ['GET', '/api/event-logs'],
  ['GET', '/api/search-engines'],
  ['GET', '/api/settings'],
  ['GET', '/api/config'],
  ['GET', '/api/sessions/abc/crons'],
  ['GET', '/api/channels/1/runtime'],
  ['POST', '/api/chat'],
  ['POST', '/api/models'],
  ['POST', '/api/agents'],
  ['POST', '/api/cron-jobs'],
  ['POST', '/api/mcp/discover'],
  ['POST', '/api/models/test'],
  ['PUT', '/api/agents/1'],
  ['PUT', '/api/agents/1/skills'],
  ['PUT', '/api/settings/timezone'],
  ['PUT', '/api/search-engines/order'],
  ['DELETE', '/api/event-logs'],
  ['DELETE', '/api/cron-jobs/1'],
];

test.describe('API auth boundary', () => {
  let anon;

  test.beforeAll(async () => {
    // Explicitly empty, not merely unset: the suite's global-setup writes an
    // authenticated state.json that the config applies by default, so an
    // "anonymous" context that only omits storageState still carries the
    // session cookie — and every assertion below would pass for the wrong
    // reason.
    anon = await apiRequest.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  });

  test.afterAll(async () => { await anon.dispose(); });

  for (const [method, path] of GUARDED) {
    test(`${method} ${path} rejects an anonymous caller`, async () => {
      // Accept: application/json picks the API branch of authMiddleware. Without
      // it the guard still fires, but as a 302 to /login for HTML-accepting
      // clients — and Playwright follows that, landing on a 200 login page,
      // which reads exactly like an unguarded route. Asserting the JSON branch
      // keeps a real failure from hiding behind a redirect.
      const res = await anon.fetch(path, {
        method,
        headers: { Accept: 'application/json' },
        data: method === 'GET' || method === 'DELETE' ? undefined : {},
      });
      expect(res.status(), `${method} ${path} should not be reachable without a session`).toBe(401);
      expect(await res.json()).toEqual({ error: 'unauthorized' });
    });
  }

  test('login and logout stay reachable without a session', async () => {
    // They are registered above the guard on purpose — guarding them would
    // make logging in impossible.
    const bad = await anon.post('/api/login', { data: { user: 'nope', password: 'nope' } });
    expect(bad.status()).toBe(401);
    expect((await bad.json()).error).toBe('invalid credentials');

    const out = await anon.post('/api/logout');
    expect(out.status()).toBe(200);
  });

  test('a page request redirects to login instead of returning JSON', async () => {
    const res = await anon.get('/admin', { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers().location).toBe('/login');
  });

  test('an authenticated caller still gets through', async ({ request }) => {
    // Guards against the opposite failure: a mount that rejects everyone.
    const res = await request.get('/api/settings');
    expect(res.status()).toBe(200);
  });
});
