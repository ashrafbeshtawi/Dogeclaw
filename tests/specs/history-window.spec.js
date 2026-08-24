// Unit-style coverage for the block-aligned session history window.
// loadSession keeps at least KEEP_MIN messages and only moves the window
// start in steps of TRIM_BLOCK, so the prompt prefix stays byte-stable
// between trims and provider prompt caching keeps working on long sessions
// (a per-turn "last N" sliding window would shift the prefix every request).
//
// historyWindowStart lives in its own pure module (no DB) so we can hit it
// directly from the test runner. Dynamic import() because the agent code is
// ESM while the test bundle is CommonJS.

const { test, expect } = require('@playwright/test');

let historyWindowStart, KEEP_MIN, TRIM_BLOCK;

test.beforeAll(async () => {
  ({ historyWindowStart, KEEP_MIN, TRIM_BLOCK } =
    await import('../../agent/src/lib/historyWindow.js'));
});

test.describe('historyWindowStart', () => {
  test('keeps everything while below the trim threshold', () => {
    expect(historyWindowStart(0)).toBe(0);
    expect(historyWindowStart(KEEP_MIN)).toBe(0);
    expect(historyWindowStart(KEEP_MIN + TRIM_BLOCK - 1)).toBe(0);
  });

  test('start only moves once per block, so the prefix is stable between trims', () => {
    expect(historyWindowStart(KEEP_MIN + TRIM_BLOCK)).toBe(TRIM_BLOCK);
    for (let c = KEEP_MIN + TRIM_BLOCK; c < KEEP_MIN + 2 * TRIM_BLOCK; c++) {
      expect(historyWindowStart(c)).toBe(TRIM_BLOCK);
    }
    expect(historyWindowStart(KEEP_MIN + 2 * TRIM_BLOCK)).toBe(2 * TRIM_BLOCK);
  });

  test('window size stays within [KEEP_MIN, KEEP_MIN + TRIM_BLOCK)', () => {
    for (let c = 0; c <= KEEP_MIN + 10 * TRIM_BLOCK; c++) {
      const kept = c - historyWindowStart(c);
      expect(kept).toBeLessThan(KEEP_MIN + TRIM_BLOCK);
      if (c >= KEEP_MIN) expect(kept).toBeGreaterThanOrEqual(KEEP_MIN);
    }
  });
});
