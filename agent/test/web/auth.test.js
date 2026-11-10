// UNIT: src/web/auth.js — login cookie tokens and the web secret.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  KNOWN_DEFAULT_SECRETS, TOKEN_MAX_AGE_S, checkCredentials, issueToken, resolveWebSecret, verifyToken,
} from '../../src/web/auth.js';

const web = { user: 'admin', password: 'hunter2-long', secret: 'a'.repeat(64) };
const NOW = 1_800_000_000_000;

test('a freshly issued token verifies', () => {
  assert.equal(verifyToken(issueToken(web, NOW), web, NOW), true);
});

test('two logins get different tokens', () => {
  assert.notEqual(issueToken(web, NOW), issueToken(web, NOW));
});

test('the old fixed cookie HMAC(secret, "authenticated") is rejected', () => {
  // What every instance on a default secret handed out before; anyone could compute it.
  for (const secret of KNOWN_DEFAULT_SECRETS) {
    const forged = createHmac('sha256', secret).update('authenticated').digest('hex');
    assert.equal(verifyToken(forged, { ...web, secret }, NOW), false);
  }
});

test('a token signed with another secret is rejected', () => {
  const forged = issueToken({ ...web, secret: 'dogeclaw-change-me' }, NOW);
  assert.equal(verifyToken(forged, web, NOW), false);
});

test('a token expires after the cookie max age', () => {
  const token = issueToken(web, NOW);
  assert.equal(verifyToken(token, web, NOW + (TOKEN_MAX_AGE_S - 1) * 1000), true);
  assert.equal(verifyToken(token, web, NOW + (TOKEN_MAX_AGE_S + 1) * 1000), false);
});

test('a token issued far in the future is rejected', () => {
  assert.equal(verifyToken(issueToken(web, NOW + 3600_000), web, NOW), false);
});

test('changing the password invalidates existing tokens', () => {
  const token = issueToken(web, NOW);
  assert.equal(verifyToken(token, { ...web, password: 'new-password' }, NOW), false);
});

test('a tampered issued-at is rejected', () => {
  const [iat, nonce, sig] = issueToken(web, NOW).split('.');
  assert.equal(verifyToken(`${Number(iat) + 1}.${nonce}.${sig}`, web, NOW), false);
});

test('malformed tokens are rejected without throwing', () => {
  for (const t of [undefined, '', 'deadbeef', 'a.b.c', '1.2.3.4', `${NOW}.${'0'.repeat(32)}.zz`]) {
    assert.equal(verifyToken(t, web, NOW), false);
  }
});

test('credentials must match exactly', () => {
  assert.equal(checkCredentials('admin', 'hunter2-long', web), true);
  assert.equal(checkCredentials('admin', 'hunter2', web), false);
  assert.equal(checkCredentials('Admin', 'hunter2-long', web), false);
  assert.equal(checkCredentials(undefined, undefined, web), false);
});

test('a real secret is kept', () => {
  const secret = 'f'.repeat(64);
  assert.deepEqual(resolveWebSecret(secret), { secret, generated: false });
});

test('missing, short or public default secrets are replaced by a random one', () => {
  for (const value of [undefined, '', '   ', 'short', ...KNOWN_DEFAULT_SECRETS]) {
    const { secret, generated } = resolveWebSecret(value);
    assert.equal(generated, true, String(value));
    assert.match(secret, /^[0-9a-f]{64}$/);
    assert.ok(!KNOWN_DEFAULT_SECRETS.includes(secret));
  }
  assert.notEqual(resolveWebSecret('').secret, resolveWebSecret('').secret);
});
