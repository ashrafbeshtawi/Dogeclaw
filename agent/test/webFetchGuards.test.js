// Unit tests for web_fetch's download guards (src/tools/web.js): non-text
// content types are refused before download, and oversized/streaming
// responses are cut at MAX_FETCH_BYTES instead of buffered whole.
// Uses a throwaway local HTTP server — no external network.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const { register } = await import('../src/tools/web.js');
const { ToolRegistry } = await import('../src/tools/index.js');

const reg = new ToolRegistry();
register(reg);
const fetchTool = args => reg.execute('web_fetch', args);

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
      // 5 MB body, streamed in chunks — must be cut at the 2 MB cap.
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

test('fetches and extracts a normal html page', async () => {
  const { pages } = await fetchTool({ url: `${base}/ok` });
  assert.equal(pages[0].status, 200);
  assert.match(pages[0].text, /hello dogeclaw/);
});

test('refuses non-text content types instead of extracting garbage', async () => {
  const { pages } = await fetchTool({ url: `${base}/pdf` });
  assert.match(pages[0].error, /Unsupported content type: application\/pdf/);
});

test('cuts oversized responses at the byte cap instead of buffering them whole', async () => {
  const { pages } = await fetchTool({ url: `${base}/big` });
  assert.equal(pages[0].status, 200);
  // extractText collapses whitespace; the page came back bounded, not 5 MB
  assert.ok(pages[0].text.length <= 8000);
  assert.equal(pages[0].error, undefined);
});
