// UNIT: src/web/managers.js — the Telegram/MCP manager holders.
//
// These are set after the web server is built, so routes look them up rather
// than receiving them. Null until index.js finishes booting is a legitimate
// state, and reloadTelegram must tolerate it: it is called from route handlers
// AFTER res.json(), where a throw would vanish into an unhandled rejection
// while the response already looked fine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getTelegramManager, setTelegramManager,
  getMcpManager, setMcpManager,
  reloadTelegram,
} from '../../src/web/managers.js';

test('both managers start unset', () => {
  // Module state is shared across this file, so this must run before the sets.
  assert.equal(getTelegramManager(), null);
  assert.equal(getMcpManager(), null);
});

test('reloadTelegram is a no-op while the manager is unset', () => {
  assert.doesNotThrow(() => reloadTelegram());
});

test('a set manager is returned by its getter', () => {
  const tm = { reload: async () => {} };
  const mcp = { reload: async () => {} };
  setTelegramManager(tm);
  setMcpManager(mcp);
  assert.equal(getTelegramManager(), tm);
  assert.equal(getMcpManager(), mcp);
});

test('reloadTelegram asks the manager to re-read its channels', () => {
  let called = 0;
  setTelegramManager({ reload: async () => { called++; } });
  reloadTelegram();
  assert.equal(called, 1);
});

test('a failing reload is logged, not thrown', async () => {
  // Callers invoke this after the response has gone out; an unhandled
  // rejection here would take the process down for a cosmetic refresh.
  const errors = [];
  const original = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    setTelegramManager({ reload: async () => { throw new Error('bot offline'); } });
    assert.doesNotThrow(() => reloadTelegram());
    await new Promise(r => setImmediate(r));
  } finally { console.error = original; }

  assert.equal(errors.length, 1);
  assert.match(errors[0], /telegram.*reload failed.*bot offline/);
});

test('managers can be replaced', () => {
  const second = { reload: async () => {} };
  setTelegramManager(second);
  assert.equal(getTelegramManager(), second);
});
