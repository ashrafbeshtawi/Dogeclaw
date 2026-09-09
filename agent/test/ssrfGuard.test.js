// SSRF guard (src/lib/ssrfGuard.js): the web tools must never reach
// internal services — private ranges, loopback, link-local/cloud metadata,
// or non-http(s) schemes. DNS lookup is injected so no real resolution runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateAddress, assertPublicUrl } from '../src/lib/ssrfGuard.js';

test('isPrivateAddress: private and special IPv4 ranges', () => {
  for (const ip of [
    '127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '100.64.0.1', '0.0.0.0',
  ]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
});

test('isPrivateAddress: public IPv4 passes', () => {
  for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '100.128.0.1', '11.0.0.1']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('isPrivateAddress: IPv6 loopback, link-local, ULA, v4-mapped', () => {
  for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  assert.equal(isPrivateAddress('2606:2800:220:1::1'), false);
  assert.equal(isPrivateAddress('::ffff:8.8.8.8'), false);
});

test('assertPublicUrl: rejects non-http(s) schemes', async () => {
  for (const url of ['ftp://example.com/x', 'file:///etc/passwd', 'gopher://example.com']) {
    await assert.rejects(assertPublicUrl(url), /Blocked non-http/, url);
  }
});

test('assertPublicUrl: rejects literal private hosts without DNS', async () => {
  for (const url of ['http://127.0.0.1:3000/api', 'http://10.0.0.1/', 'http://169.254.169.254/latest/meta-data', 'http://[::1]:8080/']) {
    await assert.rejects(assertPublicUrl(url), /Blocked private/, url);
  }
});

test('assertPublicUrl: rejects hostnames resolving to a private address', async () => {
  const lookup = async () => [{ address: '93.184.216.34' }, { address: '10.0.0.5' }];
  await assert.rejects(
    assertPublicUrl('http://evil.example.com/', { lookup }),
    /resolves to 10\.0\.0\.5/,
  );
});

test('assertPublicUrl: accepts hostnames resolving only to public addresses', async () => {
  const lookup = async () => [{ address: '93.184.216.34' }];
  const parsed = await assertPublicUrl('https://example.com/page?q=1', { lookup });
  assert.equal(parsed.hostname, 'example.com');
});
