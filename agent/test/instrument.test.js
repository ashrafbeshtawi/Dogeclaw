import { test } from 'node:test';
import assert from 'node:assert/strict';

// Contract from issue #68: with SENTRY_DSN unset the SDK must stay inert —
// no client, no log noise — so the standalone compose keeps working unchanged.
test('instrument.js is inert without SENTRY_DSN', async () => {
  delete process.env.SENTRY_DSN;
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.join(' '));
  try {
    await import('../src/instrument.js');
    const Sentry = await import('@sentry/node');
    Sentry.captureException(new Error('dropped'));
    assert.equal(await Sentry.flush(1000), false);
    assert.equal(Sentry.getClient(), undefined);
  } finally {
    Object.assign(console, orig);
  }
  assert.deepEqual(lines, []);
});
