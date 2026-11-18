// Egress proxy (src/lib/egressProxy.js): the browser's only way out. Plain
// HTTP, CONNECT tunnels (https/wss) and ws:// upgrades must reach a public
// host and nothing else, resolving the host once. `resolve` is faked so
// "public.test" points at a local server; every other host is private.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createEgressProxy } from '../src/lib/egressProxy.js';

let target, targetPort, proxy, proxyPort, resolved;

before(async () => {
  target = http.createServer((req, res) => res.end(`hello ${req.url}`));
  target.on('upgrade', (req, socket) => {
    socket.end('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
  });
  await new Promise(ok => target.listen(0, '127.0.0.1', ok));
  targetPort = target.address().port;

  proxy = createEgressProxy({
    resolve: async host => {
      resolved.push(host);
      if (host === 'public.test') return '127.0.0.1';
      throw new Error(`Blocked private/internal address: ${host}`);
    },
    log: {},
  });
  await new Promise(ok => proxy.listen(0, '127.0.0.1', ok));
  proxyPort = proxy.address().port;
});

after(() => { target.close(); proxy.close(); });

function viaProxy(options) {
  resolved = [];
  return new Promise((ok, fail) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, ...options });
    req.on('response', res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => ok({ status: res.statusCode, body }));
    });
    req.on('connect', (res, socket) => ok({ status: res.statusCode, socket }));
    req.on('upgrade', (res, socket) => { socket.destroy(); ok({ status: res.statusCode }); });
    req.on('error', fail);
    req.end();
  });
}

test('plain http to a public host is forwarded, resolving the host once', async () => {
  const res = await viaProxy({ path: `http://public.test:${targetPort}/page?q=1`, headers: { host: `public.test:${targetPort}` } });
  assert.equal(res.status, 200);
  assert.equal(res.body, 'hello /page?q=1');
  assert.deepEqual(resolved, ['public.test']);
});

test('plain http to a private host is refused', async () => {
  const res = await viaProxy({ path: 'http://metadata.internal/latest/meta-data/' });
  assert.equal(res.status, 403);
});

test('CONNECT to a public host opens a tunnel to the checked address', async () => {
  const res = await viaProxy({ method: 'CONNECT', path: `public.test:${targetPort}` });
  assert.equal(res.status, 200);
  const reply = await new Promise(ok => {
    let data = '';
    res.socket.on('data', d => { data += d; });
    res.socket.on('end', () => ok(data));
    res.socket.write(`GET /tunnelled HTTP/1.1\r\nHost: public.test\r\nConnection: close\r\n\r\n`);
  });
  assert.match(reply, /hello \/tunnelled/);
  assert.deepEqual(resolved, ['public.test']);
});

test('CONNECT to a private host is refused', async () => {
  const res = await viaProxy({ method: 'CONNECT', path: 'agent:3000' });
  assert.equal(res.status, 403);
  res.socket.destroy();
});

test('ws:// upgrade to a public host is passed through', async () => {
  const res = await viaProxy({
    path: `http://public.test:${targetPort}/socket`,
    headers: { host: `public.test:${targetPort}`, connection: 'Upgrade', upgrade: 'websocket' },
  });
  assert.equal(res.status, 101);
});

test('ws:// upgrade to a private host is refused', async () => {
  const res = await viaProxy({
    path: 'http://postgres:5432/',
    headers: { host: 'postgres:5432', connection: 'Upgrade', upgrade: 'websocket' },
  });
  assert.equal(res.status, 403);
});
