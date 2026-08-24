// Unit tests for the http_request tool (src/tools/http.js): method/header/
// body passthrough, response capping, and error surfacing.
// Uses a throwaway local HTTP server — no external network.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const { register } = await import('../src/tools/http.js');
const { ToolRegistry } = await import('../src/tools/index.js');

const reg = new ToolRegistry();
register(reg);
const run = args => reg.execute('http_request', args);

let server;
let base;

before(async () => {
  server = createServer((req, res) => {
    if (req.url === '/echo') {
      let data = '';
      req.on('data', c => (data += c));
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ method: req.method, body: data, auth: req.headers.authorization || null }));
      });
    } else if (req.url === '/big') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('z'.repeat(50000));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('nope');
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('GET returns status, content type, and body', async () => {
  const res = await run({ url: `${base}/echo` });
  assert.equal(res.status, 200);
  assert.match(res.contentType, /application\/json/);
  assert.deepEqual(JSON.parse(res.body), { method: 'GET', body: '', auth: null });
});

test('POST passes method, headers, and body through', async () => {
  const res = await run({
    url: `${base}/echo`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
    body: '{"a":1}',
  });
  assert.deepEqual(JSON.parse(res.body), { method: 'POST', body: '{"a":1}', auth: 'Bearer tok' });
});

test('headers sent as a JSON string are tolerated', async () => {
  const res = await run({ url: `${base}/echo`, headers: '{"Authorization": "Bearer tok2"}' });
  assert.equal(JSON.parse(res.body).auth, 'Bearer tok2');
});

test('non-2xx status is returned, not thrown', async () => {
  const res = await run({ url: `${base}/missing` });
  assert.equal(res.status, 404);
  assert.equal(res.body, 'nope');
});

test('oversized bodies are sliced and flagged', async () => {
  const res = await run({ url: `${base}/big` });
  assert.equal(res.body.length, 10000);
  assert.equal(res.truncated, true);
});

test('unreachable host surfaces as a tool error, not a crash', async () => {
  const res = await run({ url: 'http://127.0.0.1:1/nope', timeout_ms: 2000 });
  assert.ok(res.error);
});
