// Guarded page download shared by the web tools (src/tools/web.js).
//
// - SSRF guard: refuses private/loopback/link-local targets (see
//   ssrfGuard.js) before EVERY hop — redirects are followed manually so a
//   public page can't bounce the fetch to an internal service.
// - Refuses non-text content types before downloading (text extraction on a
//   PDF/image/zip yields garbage) and reads at most MAX_FETCH_BYTES — the
//   callers keep only a few KB of extracted text, so buffering a huge or
//   endless response first would be pure memory risk.
//
// Own dependency-free module so it can be unit-tested in isolation (see
// agent/test/fetchPage.test.js) — CI's unit stage runs without npm install,
// so test files must not pull cheerio into the module graph via web.js.
//
// opts.allowPrivate skips the SSRF guard — for tests fetching a local
// fixture server only; production callers never pass it.
//
// ponytail: the guard resolves DNS, then fetch resolves again — a rebinding
// window. Pin the resolved IP via a custom undici Agent if that ever matters.

import { assertPublicUrl } from './ssrfGuard.js';

// A real browser UA: the honest "DogeClaw/1.0" got blocked by many sites
// (news especially) — exactly the pages web_fetch is asked to read.
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MAX_REDIRECTS = 5;

export const MAX_FETCH_BYTES = 2 * 1024 * 1024;

export async function fetchPage(url, timeout = 15000, { allowPrivate = false } = {}) {
  let target = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!allowPrivate) await assertPublicUrl(target);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(target, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
        redirect: 'manual',
      });

      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        res.body?.cancel().catch(() => {});
        target = new URL(location, target).href;
        continue;
      }

      const type = res.headers.get('content-type') || '';
      if (type && !/^(text\/|application\/(json|xml|xhtml))/.test(type)) {
        controller.abort();
        throw new Error(`Unsupported content type: ${type}`);
      }
      let html = '';
      if (res.body) {
        const reader = res.body.getReader();
        const chunks = [];
        let size = 0;
        while (size < MAX_FETCH_BYTES) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          size += value.length;
        }
        if (size >= MAX_FETCH_BYTES) reader.cancel().catch(() => {});
        html = new TextDecoder().decode(Buffer.concat(chunks, Math.min(size, MAX_FETCH_BYTES)));
      }
      return { html, status: res.status, url: target };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Too many redirects fetching ${url}`);
}
