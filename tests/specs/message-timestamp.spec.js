// Unit-style coverage for the outgoing-message timestamp helper. Every
// message Agent.run() sends to the model (manual chat, telegram, cron
// trigger) gets a `[Current date/time: ...]` note appended so the model
// knows what time it is right now, in the operator's configured timezone.
//
// timestampNote lives in its own pure module (no DB, no LLM) so we can
// hit it directly from the test runner. Dynamic import() because the
// agent code is ESM while the test bundle is CommonJS.

const { test, expect } = require('@playwright/test');

let timestampNote;

test.beforeAll(async () => {
  ({ timestampNote } = await import('../../agent/src/lib/timestamp.js'));
});

const FIXED = new Date('2026-08-16T12:00:00Z');

test.describe('timestampNote', () => {
  test('formats date and time in the given timezone', () => {
    expect(timestampNote('Europe/Berlin', FIXED))
      .toBe('[Current date/time: Sunday, 16 August 2026 at 14:00:00 CEST]');
  });

  test('defaults to UTC', () => {
    expect(timestampNote(undefined, FIXED))
      .toBe('[Current date/time: Sunday, 16 August 2026 at 12:00:00 UTC]');
  });

  test('invalid timezone falls back to UTC instead of throwing', () => {
    expect(timestampNote('Not/AZone', FIXED))
      .toBe('[Current date/time: Sunday, 16 August 2026 at 12:00:00 UTC]');
  });
});
