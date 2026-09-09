// SSRF guard for the web tools: the agent fetches arbitrary URLs (often at
// the suggestion of untrusted page content), and it runs inside the compose
// network — so "fetch this URL" must never reach the admin API, postgres,
// ollama, or a cloud metadata endpoint. Stdlib-only (node:dns, node:net) so
// the no-install unit stage can test it; the DNS lookup is injectable for
// the same reason.

import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export function isPrivateAddress(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127
      || (a === 100 && b >= 64 && b <= 127)   // 100.64/10 CGNAT
      || (a === 169 && b === 254)             // link-local + cloud metadata
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168);
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::' || v6 === '::1') return true;
  if (v6.startsWith('fe80') || v6.startsWith('fc') || v6.startsWith('fd')) return true;
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7)); // v4-mapped
  return false;
}

// Throws unless url is http(s) and every address its hostname resolves to is
// public. Returns the parsed URL.
export async function assertPublicUrl(url, { lookup = dnsLookup } = {}) {
  const parsed = new URL(url); // throws on garbage
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked non-http(s) URL: ${url}`);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, ''); // [::1] bracket form
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true });
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error(`Blocked private/internal address: ${parsed.hostname} resolves to ${address}`);
    }
  }
  return parsed;
}
