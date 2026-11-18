// Web UI session tokens.
//
// The cookie is stateless: nothing is stored server-side, the server only
// checks that the token carries a valid HMAC under the web secret. Whoever
// knows the secret can therefore mint a valid cookie without ever logging in,
// so the secret must be private (see resolveWebSecret) and the token carries
// enough to limit what a leaked one is worth:
//
//   <issued-at seconds>.<random nonce>.<hmac>
//
// The HMAC covers issued-at, nonce and a hash of user + password, so a token
// expires after TOKEN_MAX_AGE_S and every token dies when the password changes.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOKEN_MAX_AGE_S = 24 * 60 * 60;
// Tolerated clock drift for an issued-at slightly in the future.
const CLOCK_SKEW_S = 60;

// Values shipped in docker-compose.yml, .env.example and older config.js.
// They are public, so a secret equal to one of them is as good as none.
export const KNOWN_DEFAULT_SECRETS = [
  'dogeclaw-default-secret-change-me',
  'dogeclaw-change-me',
];
const MIN_SECRET_LENGTH = 16;

/**
 * Returns the secret to sign tokens with. A missing, short or publicly known
 * secret is replaced by a random one for this process: the instance stays
 * safe, logins just do not survive a restart. `generated` tells the caller to
 * warn about it.
 */
export function resolveWebSecret(value) {
  const secret = (value || '').trim();
  if (secret.length >= MIN_SECRET_LENGTH && !KNOWN_DEFAULT_SECRETS.includes(secret)) {
    return { secret, generated: false };
  }
  return { secret: randomBytes(32).toString('hex'), generated: true };
}

const sha256 = data => createHash('sha256').update(data).digest();

function credentialFingerprint(user, password) {
  return sha256(`${user}\0${password}`).toString('hex');
}

function mac(secret, payload) {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function payloadOf(iat, nonce, web) {
  return `v1.${iat}.${nonce}.${credentialFingerprint(web.user, web.password)}`;
}

// Hashing both sides first gives equal-length buffers, so timingSafeEqual
// never throws and the comparison does not leak the expected length.
export function safeEqual(a, b) {
  return timingSafeEqual(sha256(String(a)), sha256(String(b)));
}

export function checkCredentials(user, password, web) {
  // Both compared unconditionally so the timing does not tell which one was wrong.
  const userOk = safeEqual(user ?? '', web.user);
  const passwordOk = safeEqual(password ?? '', web.password);
  return userOk && passwordOk;
}

export function issueToken(web, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const nonce = randomBytes(16).toString('hex');
  return `${iat}.${nonce}.${mac(web.secret, payloadOf(iat, nonce, web))}`;
}

export function verifyToken(token, web, now = Date.now()) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [iatRaw, nonce, sig] = parts;
  if (!/^\d+$/.test(iatRaw) || !/^[0-9a-f]{32}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(sig)) return false;

  const iat = Number(iatRaw);
  const nowS = Math.floor(now / 1000);
  if (iat > nowS + CLOCK_SKEW_S || nowS - iat > TOKEN_MAX_AGE_S) return false;

  const expected = Buffer.from(mac(web.secret, payloadOf(iat, nonce, web)), 'hex');
  return timingSafeEqual(expected, Buffer.from(sig, 'hex'));
}
