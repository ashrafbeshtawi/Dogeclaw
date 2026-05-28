// The canonical slash-command list the manager registers with Telegram on
// every bot start (`bot.setMyCommands`). We can't verify Telegram itself
// received the call without a real bot, but we CAN verify:
//
//   1. The endpoint exposes the expected list.
//   2. The /start greeting and Telegram's `/` menu would stay in sync —
//      the inline text in #startBot is generated from the same constant
//      this endpoint serves.
//
// The Telegram round-trip is exercised manually in the PR's test plan.

const { test, expect } = require('@playwright/test');

const EXPECTED_COMMANDS = ['start', 'new', 'reset', 'cron'];

test.describe('telegram bot commands endpoint', () => {
  test('returns the canonical command list', async ({ request }) => {
    const res = await request.get('/api/telegram/commands');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.commands)).toBeTruthy();
    expect(body.commands.length).toBe(EXPECTED_COMMANDS.length);

    const names = body.commands.map(c => c.command);
    for (const expected of EXPECTED_COMMANDS) {
      expect(names).toContain(expected);
    }
  });

  test('each command has a non-empty description ≤ 256 chars', async ({ request }) => {
    // Telegram's setMyCommands rejects descriptions outside [1, 256] chars.
    const body = await (await request.get('/api/telegram/commands')).json();
    for (const c of body.commands) {
      expect(typeof c.command).toBe('string');
      expect(c.command.length).toBeGreaterThan(0);
      expect(typeof c.description).toBe('string');
      expect(c.description.length).toBeGreaterThan(0);
      expect(c.description.length).toBeLessThanOrEqual(256);
      // Telegram-side validation: command names are [a-z0-9_]{1,32}, no slash.
      expect(c.command).toMatch(/^[a-z][a-z0-9_]{0,31}$/);
    }
  });

});
