// Browser sessions for the browser_* tools. The browser itself is Camoufox
// (stealth Firefox), started inside the agent container by the entrypoint and
// exposing a Playwright websocket on localhost; we connect to it lazily on
// first use and give every conversation its own browser context (cookies,
// logins, open page), so two chats never share a login. Contexts close after
// an idle timeout.
//
// The SSRF boundary is the egress proxy (egressProxy.js): Camoufox sends every
// connection through it, including redirect hops and WebSockets. The route
// guard below only catches a blocked URL early with a clear abort; it cannot
// see redirect hops, WebSockets or service-worker fetches on its own, which is
// why service workers are blocked too.
//
// playwright-core is imported lazily and `connect` is injectable, so unit
// tests run against a fake browser without the package in the module graph.

import { assertPublicUrl } from './ssrfGuard.js';

export const IDLE_MS = 10 * 60 * 1000;
export const MAX_SESSIONS = 5;

export async function connectCamoufox(wsEndpoint) {
  const { firefox } = await import('playwright-core');
  return firefox.connect(wsEndpoint, { timeout: 30_000 });
}

// Returns true when the request may go out. http(s) must resolve to a public
// address; data:, blob: and about: never leave the browser; anything else
// (file:, chrome:, ...) is refused.
export async function isAllowedRequest(url, guard = assertPublicUrl) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  const proto = parsed.protocol;
  if (proto === 'data:' || proto === 'blob:' || proto === 'about:') return true;
  if (proto !== 'http:' && proto !== 'https:') return false;
  try {
    await guard(parsed.href);
    return true;
  } catch {
    return false;
  }
}

export class BrowserSessions {
  #connect;
  #guard;
  #idleMs;
  #max;
  #browser = null;
  #connecting = null;
  #sessions = new Map(); // key -> { context, page, timer, lastUsed }

  constructor({ connect, guard = assertPublicUrl, idleMs = IDLE_MS, maxSessions = MAX_SESSIONS }) {
    this.#connect = connect;
    this.#guard = guard;
    this.#idleMs = idleMs;
    this.#max = maxSessions;
  }

  has(key) {
    return this.#sessions.has(key);
  }

  get size() {
    return this.#sessions.size;
  }

  // The page of this conversation, opening a fresh context when there is none.
  async page(key) {
    let s = this.#sessions.get(key);
    if (!s) {
      if (this.#sessions.size >= this.#max) await this.#closeOldest();
      const browser = await this.#getBrowser();
      const context = await browser.newContext({ serviceWorkers: 'block' });
      await context.route('**/*', async route => {
        if (await isAllowedRequest(route.request().url(), this.#guard)) return route.continue();
        return route.abort('blockedbyclient');
      });
      const page = await context.newPage();
      s = { context, page, timer: null, lastUsed: 0 };
      this.#sessions.set(key, s);
    }
    this.#touch(key, s);
    return s.page;
  }

  async close(key) {
    const s = this.#sessions.get(key);
    if (!s) return false;
    this.#sessions.delete(key);
    clearTimeout(s.timer);
    await s.context.close().catch(() => {});
    return true;
  }

  async closeAll() {
    await Promise.all([...this.#sessions.keys()].map(k => this.close(k)));
    const browser = this.#browser;
    this.#browser = null;
    if (browser) await browser.close().catch(() => {});
  }

  async #getBrowser() {
    if (this.#browser?.isConnected()) return this.#browser;
    if (!this.#connecting) {
      this.#connecting = this.#connect()
        .then(browser => {
          this.#browser = browser;
          // A restarted Camoufox drops every context; forget them so the next
          // call reconnects instead of using dead pages.
          browser.on?.('disconnected', () => {
            if (this.#browser === browser) this.#browser = null;
            for (const s of this.#sessions.values()) clearTimeout(s.timer);
            this.#sessions.clear();
          });
          return browser;
        })
        .finally(() => { this.#connecting = null; });
    }
    return this.#connecting;
  }

  #touch(key, s) {
    s.lastUsed = Date.now();
    clearTimeout(s.timer);
    s.timer = setTimeout(() => { this.close(key); }, this.#idleMs);
    s.timer.unref?.();
  }

  async #closeOldest() {
    let oldest = null;
    for (const [key, s] of this.#sessions) {
      if (!oldest || s.lastUsed < oldest.lastUsed) oldest = { key, lastUsed: s.lastUsed };
    }
    if (oldest) await this.close(oldest.key);
  }
}

// One browser context per agent and conversation (web session, or
// telegram channel + chat).
export function sessionKey({ agentId, sessionId, channelId, chatId } = {}) {
  const convo = sessionId ?? (channelId != null || chatId != null ? `${channelId}:${chatId}` : 'default');
  return `${agentId ?? '-'}|${convo}`;
}
