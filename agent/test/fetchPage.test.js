// Unit tests for the guarded page download (src/lib/fetchPage.js): non-text
// content types are refused before download, and oversized/streaming
// responses are cut at MAX_FETCH_BYTES instead of buffered whole.
// Uses a throwaway local HTTP server — no external network, no npm deps
// (CI's unit stage runs without npm install, so web.js/cheerio must stay
// out of the module graph).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fetchPage, MAX_FETCH_BYTES } from '../src/lib/fetchPage.js';

let server;
let base;

before(async () => {
  server = createServer((req, res) => {
    if (req.url === '/ok') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><main>hello dogeclaw</main></body></html>');
    } else if (req.url === '/pdf') {
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      res.end('%PDF-1.4 not really');
    } else if (req.url === '/big') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      // 5 MB body, streamed in chunks — must be cut at the byte cap.
      const chunk = 'a'.repeat(64 * 1024);
      for (let i = 0; i < 80; i++) res.write(chunk);
      res.end();
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('nope');
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('fetches a normal html page', async () => {
  const { html, status } = await fetchPage(`${base}/ok`);
  assert.equal(status, 200);
  assert.match(html, /hello dogeclaw/);
});

test('refuses non-text content types instead of downloading garbage', async () => {
  await assert.rejects(fetchPage(`${base}/pdf`), /Unsupported content type: application\/pdf/);
});

test('cuts oversized responses at the byte cap instead of buffering them whole', async () => {
  const { html, status } = await fetchPage(`${base}/big`);
  assert.equal(status, 200);
  assert.equal(html.length, MAX_FETCH_BYTES);
});

test('non-html status pages still come back as text', async () => {
  const { html, status } = await fetchPage(`${base}/missing`);
  assert.equal(status, 404);
  assert.equal(html, 'nope');
});
