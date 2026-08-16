// Unit tests for the per-session async mutex (src/lib/sessionLock.js).
// Run with: npm test (node --test, stdlib only — no framework).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { withSessionLock } from '../src/lib/sessionLock.js';

test('serializes concurrent calls on the same session', async () => {
  const order = [];
  const slow = withSessionLock('s1', async () => {
    order.push('slow-start');
    await sleep(20);
    order.push('slow-end');
  });
  const fast = withSessionLock('s1', async () => {
    order.push('fast');
  });
  await Promise.all([slow, fast]);
  assert.deepEqual(order, ['slow-start', 'slow-end', 'fast']);
});

test('different sessions do not block each other', async () => {
  const order = [];
  const a = withSessionLock('a', async () => {
    await sleep(20);
    order.push('a');
  });
  const b = withSessionLock('b', async () => {
    order.push('b');
  });
  await Promise.all([a, b]);
  assert.deepEqual(order, ['b', 'a']);
});

test('returns the callback result', async () => {
  assert.equal(await withSessionLock('s1', async () => 42), 42);
});

test('releases the lock when the callback throws', async () => {
  await assert.rejects(
    withSessionLock('s1', async () => { throw new Error('boom'); }),
    /boom/,
  );
  // A follow-up call on the same session must not deadlock.
  assert.equal(await withSessionLock('s1', async () => 'ok'), 'ok');
});

test('falsy sessionId bypasses locking entirely', async () => {
  assert.equal(await withSessionLock(null, () => 7), 7);
  assert.equal(await withSessionLock(undefined, () => 8), 8);
});
