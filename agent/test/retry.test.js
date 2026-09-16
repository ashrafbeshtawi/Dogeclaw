import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWithRetry } from '../src/lib/retry.js';

// No real waiting: every test injects a sleep that just records the delay.
function recorder() {
  const slept = [];
  return { slept, sleep: async ms => { slept.push(ms); } };
}

test('returns immediately on success without sleeping', async () => {
  const { slept, sleep } = recorder();
  const out = await runWithRetry(async () => 'ok', { sleep });
  assert.equal(out, 'ok');
  assert.deepEqual(slept, []);
});

test('retries until success and reports the attempt number', async () => {
  const { slept, sleep } = recorder();
  const seen = [];
  const out = await runWithRetry(async attempt => {
    seen.push(attempt);
    if (attempt < 3) throw new Error('flaky');
    return 'ok';
  }, { delays: [10, 20], sleep });

  assert.equal(out, 'ok');
  assert.deepEqual(seen, [1, 2, 3]);
  assert.deepEqual(slept, [10, 20]);
});

test('gives up after delays are exhausted and rethrows the last error', async () => {
  const { slept, sleep } = recorder();
  let calls = 0;
  await assert.rejects(
    () => runWithRetry(async () => { calls++; throw new Error(`boom ${calls}`); }, { delays: [1, 2], sleep }),
    /boom 3/,
  );
  // delays.length + 1 attempts, and no sleep after the final failure.
  assert.equal(calls, 3);
  assert.deepEqual(slept, [1, 2]);
});

test('onRetry fires once per retry, never after the last failure', async () => {
  const { sleep } = recorder();
  const retries = [];
  await assert.rejects(() => runWithRetry(
    async () => { throw new Error('nope'); },
    { delays: [1, 2], sleep, onRetry: (err, attempt) => retries.push([attempt, err.message]) },
  ));
  assert.deepEqual(retries, [[1, 'nope'], [2, 'nope']]);
});

test('empty delays means a single attempt', async () => {
  const { slept, sleep } = recorder();
  let calls = 0;
  await assert.rejects(
    () => runWithRetry(async () => { calls++; throw new Error('once'); }, { delays: [], sleep }),
    /once/,
  );
  assert.equal(calls, 1);
  assert.deepEqual(slept, []);
});
