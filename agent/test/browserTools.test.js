// Unit tests for the Camoufox browser tools (src/tools/browser.js) and their
// session pool (src/lib/browserSessions.js). The browser is a fake with the
// slice of the Playwright API the tools use — no Camoufox, no network, and
// playwright-core stays out of the module graph.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRegistry } from '../src/tools/index.js';
import { register } from '../src/tools/browser.js';
import { BrowserSessions, isAllowedRequest, sessionKey } from '../src/lib/browserSessions.js';

const PAGES = {
  'https://example.com/': '<html><head><title>Example</title></head><body><main>Hello browser <a href="/next">Next</a></main></body></html>',
  'https://example.com/next': '<html><head><title>Next</title></head><body><main>Second page</main></body></html>',
};

function fakeBrowser() {
  const log = { contexts: 0, closedContexts: 0, routes: [], actions: [] };
  const browser = {
    log,
    isConnected: () => true,
    on() {},
    close: async () => {},
    async newContext(options) {
      log.contexts++;
      log.contextOptions = options;
      let current = 'about:blank';
      const page = {
        async goto(url) { current = url; log.actions.push(['goto', url]); return { status: () => 200 }; },
        async waitForLoadState() {},
        async content() { return PAGES[current] ?? '<html><body></body></html>'; },
        url: () => current,
        async title() { return /<title>(.*?)<\/title>/.exec(PAGES[current] ?? '')?.[1] ?? ''; },
        async click(sel) { log.actions.push(['click', sel]); if (sel === 'text=Next') current = 'https://example.com/next'; },
        async fill(sel, text) { log.actions.push(['fill', sel, text]); },
        async press(sel, key) { log.actions.push(['press', sel, key]); },
        async screenshot() { return Buffer.from('PNG'); },
      };
      return {
        async route(pattern, handler) { log.routes.push(handler); },
        async newPage() { return page; },
        async close() { log.closedContexts++; },
      };
    },
  };
  return browser;
}

const publicGuard = async url => {
  if (new URL(url).hostname === 'internal') throw new Error('Blocked private/internal address');
  return new URL(url);
};

function setup(opts = {}) {
  const browser = fakeBrowser();
  let connects = 0;
  const sessions = new BrowserSessions({
    connect: async () => { connects++; return browser; },
    guard: publicGuard,
    ...opts,
  });
  const registry = new ToolRegistry();
  return { browser, sessions, registry, connects: () => connects };
}

const CTX = { agentId: 1, sessionId: 'web-1' };

test('browser_open renders the page and lists its links', async () => {
  const { sessions, registry } = setup();
  register(registry, { sessions, filesDir: '/tmp', guard: publicGuard });
  const res = await registry.execute('browser_open', { url: 'https://example.com/' }, CTX);
  assert.equal(res.status, 200);
  assert.equal(res.title, 'Example');
  assert.match(res.text, /Hello browser/);
  assert.deepEqual(res.links, [{ url: 'https://example.com/next', text: 'Next' }]);
});

test('browser_open refuses private targets before opening anything', async () => {
  const { browser, sessions, registry, connects } = setup();
  register(registry, { sessions, filesDir: '/tmp', guard: publicGuard });
  const res = await registry.execute('browser_open', { url: 'http://internal/admin' }, CTX);
  assert.match(res.error, /Blocked/);
  assert.equal(browser.log.actions.length, 0);
  assert.equal(connects(), 0);
});

test('click, type and read act on the conversation\'s open page', async () => {
  const { browser, sessions, registry } = setup();
  register(registry, { sessions, filesDir: '/tmp', guard: publicGuard });
  await registry.execute('browser_open', { url: 'https://example.com/' }, CTX);

  const clicked = await registry.execute('browser_click', { selector: 'text=Next' }, CTX);
  assert.equal(clicked.url, 'https://example.com/next');
  assert.match(clicked.text, /Second page/);

  await registry.execute('browser_type', { selector: '#q', text: 'doge', submit: true }, CTX);
  assert.deepEqual(browser.log.actions.slice(-2), [['fill', '#q', 'doge'], ['press', '#q', 'Enter']]);

  const read = await registry.execute('browser_read', {}, CTX);
  assert.equal(read.title, 'Next');
});

test('actions without an open page say so instead of opening a blank one', async () => {
  const { sessions, registry, connects } = setup();
  register(registry, { sessions, filesDir: '/tmp', guard: publicGuard });
  for (const tool of ['browser_click', 'browser_type', 'browser_read', 'browser_screenshot']) {
    const res = await registry.execute(tool, { selector: 'a', text: 'x' }, CTX);
    assert.match(res.error, /browser_open first/, tool);
  }
  assert.equal(connects(), 0);
});

test('browser_screenshot writes a PNG under files/screenshots', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dogeclaw-shot-'));
  try {
    const { sessions, registry } = setup();
    register(registry, { sessions, filesDir: dir, guard: publicGuard });
    await registry.execute('browser_open', { url: 'https://example.com/' }, CTX);
    const res = await registry.execute('browser_screenshot', {}, CTX);
    assert.ok(res.path.startsWith(join(dir, 'screenshots')));
    assert.equal(await readFile(res.path, 'utf8'), 'PNG');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('conversations get separate contexts; browser_close drops only its own', async () => {
  const { browser, sessions, registry, connects } = setup();
  register(registry, { sessions, filesDir: '/tmp', guard: publicGuard });
  const other = { agentId: 1, channelId: 3, chatId: 42 };
  await registry.execute('browser_open', { url: 'https://example.com/' }, CTX);
  await registry.execute('browser_open', { url: 'https://example.com/' }, other);
  assert.equal(browser.log.contexts, 2);
  assert.equal(connects(), 1); // one connection, shared

  assert.deepEqual(await registry.execute('browser_close', {}, CTX), { closed: true });
  assert.deepEqual(await registry.execute('browser_close', {}, CTX), { closed: false });
  assert.ok(sessions.has(sessionKey(other)));
});

test('the pool closes the least recently used context when full', async () => {
  const { browser, sessions } = setup({ maxSessions: 2 });
  await sessions.page('a');
  await new Promise(r => setTimeout(r, 2));
  await sessions.page('b');
  await new Promise(r => setTimeout(r, 2));
  await sessions.page('a'); // a is now the most recent
  await sessions.page('c');
  assert.equal(browser.log.closedContexts, 1);
  assert.ok(sessions.has('a') && sessions.has('c') && !sessions.has('b'));
  await sessions.closeAll();
});

test('idle contexts are closed after the timeout', async () => {
  const { sessions } = setup({ idleMs: 10 });
  await sessions.page('a');
  await new Promise(r => setTimeout(r, 30));
  assert.equal(sessions.has('a'), false);
});

test('every context routes requests through the guard and blocks service workers', async () => {
  const { browser, sessions } = setup();
  await sessions.page('a');
  // Service-worker fetches would skip the route handler.
  assert.equal(browser.log.contextOptions.serviceWorkers, 'block');
  const [handler] = browser.log.routes;
  const run = async url => {
    let outcome;
    await handler({
      request: () => ({ url: () => url }),
      continue: async () => { outcome = 'continue'; },
      abort: async () => { outcome = 'abort'; },
    });
    return outcome;
  };
  assert.equal(await run('https://example.com/app.js'), 'continue');
  assert.equal(await run('http://internal/api'), 'abort');
  assert.equal(await run('file:///etc/passwd'), 'abort');
  await sessions.closeAll();
});

test('isAllowedRequest: local schemes pass, other schemes are refused', async () => {
  assert.equal(await isAllowedRequest('data:text/plain,hi', publicGuard), true);
  assert.equal(await isAllowedRequest('about:blank', publicGuard), true);
  assert.equal(await isAllowedRequest('chrome://settings', publicGuard), false);
  assert.equal(await isAllowedRequest('not a url', publicGuard), false);
});

test('sessionKey separates agents and conversations', () => {
  assert.equal(sessionKey({ agentId: 1, sessionId: 's' }), '1|s');
  assert.equal(sessionKey({ agentId: 1, channelId: 2, chatId: 3 }), '1|2:3');
  assert.notEqual(sessionKey({ agentId: 1, sessionId: 's' }), sessionKey({ agentId: 2, sessionId: 's' }));
  assert.equal(sessionKey({}), '-|default');
});
