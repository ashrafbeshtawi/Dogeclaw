import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertPublicUrl } from '../lib/ssrfGuard.js';
import { sessionKey } from '../lib/browserSessions.js';
import { extractText, extractLinks } from '../lib/webExtract.js';

// Real browser (Camoufox) for pages web_fetch cannot read: JS-rendered
// pages, logins, sites that block plain fetches. Only registered when
// DOGECLAW_BROWSER=true (see index.js). Same budget as web_fetch:
// agent.js truncates every tool result at 12000 chars of JSON.
const TEXT_BUDGET = 8000;
const LINK_BUDGET = 30;
const NAV_TIMEOUT = 30_000;
const ACTION_TIMEOUT = 10_000;
// After load, give client-side rendering a moment to settle — capped, since
// many pages never go network-idle (analytics, long polling).
const SETTLE_TIMEOUT = 5_000;

const NO_PAGE = { error: 'No open page in this conversation. Call browser_open first.' };

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT }).catch(() => {});
}

async function snapshot(page, selector) {
  const html = await page.content();
  const url = page.url();
  return {
    url,
    title: await page.title().catch(() => ''),
    text: extractText(html, selector).slice(0, TEXT_BUDGET),
    links: extractLinks(html, url).slice(0, LINK_BUDGET),
  };
}

export function register(registry, { sessions, filesDir, guard = assertPublicUrl }) {
  // Run fn with this conversation's page; errors come back as tool errors.
  const withPage = (fn, { open = false } = {}) => async (args, context) => {
    const key = sessionKey(context);
    if (!open && !sessions.has(key)) return NO_PAGE;
    try {
      return await fn(await sessions.page(key), args, key);
    } catch (err) {
      return { error: err.message };
    }
  };

  // --- browser_open ---
  registry.register('browser_open', {
    type: 'function',
    function: {
      name: 'browser_open',
      description: 'Open a URL in a real (stealth) web browser and return the rendered text and links. Use this instead of web_fetch for JavaScript-heavy pages, sites that block plain fetches, or when you need to log in, click or fill forms. The page stays open for this conversation (cookies and logins persist) until browser_close or 10 minutes of inactivity.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to open (http or https)' },
          selector: { type: 'string', description: 'CSS selector to extract specific content (optional)' },
        },
        required: ['url'],
      },
    },
  }, async (args, context) => {
    // Clear error before any browser is touched; the route guard in
    // browserSessions.js covers redirects and subrequests.
    try { await guard(args.url); } catch (err) { return { url: args.url, error: err.message }; }
    return open(args, context);
  });
  const open = withPage(async (page, { url, selector }) => {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await settle(page);
    return { status: response?.status() ?? null, ...(await snapshot(page, selector)) };
  }, { open: true });

  // --- browser_click ---
  registry.register('browser_click', {
    type: 'function',
    function: {
      name: 'browser_click',
      description: 'Click an element on the page open in the browser, then return the resulting page. The selector is CSS (e.g. "button[type=submit]") or Playwright text syntax (e.g. "text=Accept all").',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'Element to click' },
        },
        required: ['selector'],
      },
    },
  }, withPage(async (page, { selector }) => {
    await page.click(selector, { timeout: ACTION_TIMEOUT });
    await settle(page);
    return snapshot(page);
  }));

  // --- browser_type ---
  registry.register('browser_type', {
    type: 'function',
    function: {
      name: 'browser_type',
      description: 'Fill a text field on the page open in the browser (replacing its content), optionally pressing Enter afterwards, then return the resulting page.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'Input to fill, CSS or Playwright text syntax' },
          text: { type: 'string', description: 'Text to enter' },
          submit: { type: 'boolean', description: 'Press Enter after typing (default false)' },
        },
        required: ['selector', 'text'],
      },
    },
  }, withPage(async (page, { selector, text, submit }) => {
    await page.fill(selector, String(text ?? ''), { timeout: ACTION_TIMEOUT });
    if (submit) await page.press(selector, 'Enter', { timeout: ACTION_TIMEOUT });
    await settle(page);
    return snapshot(page);
  }));

  // --- browser_read ---
  registry.register('browser_read', {
    type: 'function',
    function: {
      name: 'browser_read',
      description: 'Return the text and links of the page currently open in the browser, optionally only a part of it.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector to extract specific content (optional)' },
        },
      },
    },
  }, withPage(async (page, { selector } = {}) => snapshot(page, selector)));

  // --- browser_screenshot ---
  registry.register('browser_screenshot', {
    type: 'function',
    function: {
      name: 'browser_screenshot',
      description: 'Save a PNG screenshot of the page open in the browser to the workspace and return its path.',
      parameters: {
        type: 'object',
        properties: {
          full_page: { type: 'boolean', description: 'Capture the whole scrollable page (default false: the visible part)' },
        },
      },
    },
  }, withPage(async (page, { full_page } = {}) => {
    const dir = join(filesDir, 'screenshots');
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
    await writeFile(path, await page.screenshot({ fullPage: !!full_page, timeout: NAV_TIMEOUT }));
    return { url: page.url(), path };
  }));

  // --- browser_close ---
  registry.register('browser_close', {
    type: 'function',
    function: {
      name: 'browser_close',
      description: 'Close the browser page of this conversation and forget its cookies and logins.',
      parameters: { type: 'object', properties: {} },
    },
  }, async (_args, context) => ({ closed: await sessions.close(sessionKey(context)) }));
}
