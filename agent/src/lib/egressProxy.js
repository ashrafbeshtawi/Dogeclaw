// Egress proxy for the browser. Camoufox is launched with this proxy, so every
// connection the browser opens goes through here: each hop of a redirect,
// WebSockets, service-worker fetches and subresources alike - the gaps a
// Playwright route handler cannot see. The proxy resolves each host once,
// checks that every answer is public (ssrfGuard) and connects to exactly the
// checked address, so a second DNS answer (rebinding) never reaches a socket.
//
// HTTPS and WebSocket traffic arrives as CONNECT tunnels; plain http:// as
// absolute-form requests or upgrades. `resolve` is injectable so tests can
// point "public" hosts at local servers.

import http from 'node:http';
import net from 'node:net';
import { resolvePublicAddress } from './ssrfGuard.js';

// Hop-by-hop headers that belong to the browser-to-proxy leg only.
const PROXY_HEADERS = ['proxy-connection', 'proxy-authorization', 'keep-alive'];

export function createEgressProxy({ resolve = resolvePublicAddress, log = console } = {}) {
  // The checked address, or null when the host is private or does not resolve.
  const check = async hostname => {
    try {
      return await resolve(hostname);
    } catch (err) {
      log.warn?.(`[egress-proxy] refused ${hostname}: ${err.message}`);
      return null;
    }
  };

  const server = http.createServer(async (req, res) => {
    let target;
    try {
      target = new URL(req.url);
      if (target.protocol !== 'http:') throw new Error(`Unsupported proxy request: ${req.url}`);
    } catch {
      return refuse(res, 400);
    }
    const address = await check(target.hostname);
    if (!address) return refuse(res, 403);

    const headers = { ...req.headers };
    for (const h of PROXY_HEADERS) delete headers[h];
    const upstream = http.request({
      host: address,
      port: target.port || 80,
      method: req.method,
      path: target.pathname + target.search,
      headers,
    }, upRes => {
      res.writeHead(upRes.statusCode, upRes.rawHeaders);
      upRes.pipe(res);
    });
    upstream.on('error', () => refuse(res, 502));
    req.pipe(upstream);
  });

  // HTTPS, wss:// and (in Firefox) ws:// through a proxy: a raw TCP tunnel.
  server.on('connect', async (req, client, head) => {
    client.on('error', () => {});
    const { hostname, port } = splitAuthority(req.url);
    const address = hostname && port ? await check(hostname) : null;
    if (!address) return client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    tunnel(client, address, port, head, () => client.write('HTTP/1.1 200 Connection Established\r\n\r\n'));
  });

  // ws:// sent as an absolute-form upgrade instead of a tunnel.
  server.on('upgrade', async (req, client, head) => {
    client.on('error', () => {});
    let target;
    try { target = new URL(req.url); } catch { return client.end('HTTP/1.1 400 Bad Request\r\n\r\n'); }
    const address = target.protocol === 'http:' || target.protocol === 'ws:' ? await check(target.hostname) : null;
    if (!address) return client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    const lines = [`${req.method} ${target.pathname}${target.search} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      if (!PROXY_HEADERS.includes(req.rawHeaders[i].toLowerCase())) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    const requestHead = Buffer.from(lines.join('\r\n') + '\r\n\r\n');
    tunnel(client, address, target.port || 80, Buffer.concat([requestHead, head]));
  });

  server.on('clientError', (err, socket) => socket.destroy());
  return server;
}

export function startEgressProxy({ port, host = '127.0.0.1', ...opts }) {
  const server = createEgressProxy(opts);
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => ok(server));
  });
}


function refuse(res, status) {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { 'content-type': 'text/plain' }).end(http.STATUS_CODES[status]);
}

// "example.com:443" or "[2001:db8::1]:443" -> { hostname, port }
function splitAuthority(authority) {
  const m = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(authority ?? '');
  return m ? { hostname: m[1], port: Number(m[2]) } : {};
}

function tunnel(client, address, port, head, onOpen) {
  const upstream = net.connect(Number(port), address, () => {
    onOpen?.();
    if (head?.length) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  upstream.on('error', () => client.destroy());
  client.on('close', () => upstream.destroy());
}
