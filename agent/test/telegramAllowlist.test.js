// UNIT: isAllowedUser from src/channels/telegram.js — the gate every
// incoming Telegram message passes before it reaches the agent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedUser } from '../src/channels/telegram.js';

test('empty allowlist denies everyone', () => {
  assert.equal(isAllowedUser([], 111), false);
});

test('missing allowlist denies everyone', () => {
  assert.equal(isAllowedUser(null, 111), false);
  assert.equal(isAllowedUser(undefined, 111), false);
});

test('listed user is allowed', () => {
  assert.equal(isAllowedUser([111, 222], 222), true);
});

test('unlisted user is denied', () => {
  assert.equal(isAllowedUser([111, 222], 333), false);
});

test('BIGINT ids from pg arrive as strings and still match numeric ids', () => {
  assert.equal(isAllowedUser(['111', '222'], 111), true);
  assert.equal(isAllowedUser(['111'], '111'), true);
});
