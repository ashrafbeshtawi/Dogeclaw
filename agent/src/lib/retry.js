// Bounded retry for work that fails for reasons outside our control.
//
// Cron runs fail in two very different ways. A misconfigured job (no model
// assigned, deleted channel) fails identically forever, and retrying only
// burns time. An upstream hiccup — most often an LLM provider that
// load-balances a model across backends, where the same request is accepted
// by the next one — succeeds on a second try. Callers keep their permanent
// setup outside `fn` so only the worth-retrying work runs through here.

const DEFAULT_DELAYS_MS = [2_000, 15_000];

/**
 * Calls `fn(attempt)` until it resolves or the delays run out, then rethrows
 * the last error. One more attempt is made than there are delays, so the
 * default is three attempts spaced 2s and 15s apart.
 *
 * `sleep` is injectable so tests don't wait in real time.
 */
export async function runWithRetry(fn, opts = {}) {
  const delays = opts.delays ?? DEFAULT_DELAYS_MS;
  const sleep = opts.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt > delays.length) throw err;
      opts.onRetry?.(err, attempt);
      await sleep(delays[attempt - 1]);
    }
  }
}
