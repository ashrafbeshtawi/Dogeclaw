// Guarded page download shared by the web tools (src/tools/web.js).
//
// Refuses non-text content types before downloading (text extraction on a
// PDF/image/zip yields garbage) and reads at most MAX_FETCH_BYTES — the
// callers keep only a few KB of extracted text, so buffering a huge or
// endless response first would be pure memory risk.
//
// Own dependency-free module so it can be unit-tested in isolation (see
// agent/test/fetchPage.test.js) — CI's unit stage runs without npm install,
// so test files must not pull cheerio into the module graph via web.js.

const USER_AGENT = 'Mozilla/5.0 (compatible; DogeClaw/1.0)';

export const MAX_FETCH_BYTES = 2 * 1024 * 1024;

export async function fetchPage(url, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
      redirect: 'follow',
    });
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
    return { html, status: res.status, url: res.url };
  } finally {
    clearTimeout(timer);
  }
}
