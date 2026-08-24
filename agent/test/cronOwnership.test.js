// Unit tests for the cron-job ownership rule (src/lib/cronOwnership.js):
// manage_cron list/remove must only see jobs bound to the calling
// conversation — telegram channel+chat, or web session.
// Run with: npm test (node --test, stdlib only — no framework).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownsJob } from '../src/lib/cronOwnership.js';

const tgJob = { channel_id: 3, chat_id: '42', session_id: null };
const webJob = { channel_id: null, chat_id: null, session_id: 'web-abc' };

test('telegram job matches its own channel+chat', () => {
  assert.equal(ownsJob(tgJob, { channelId: 3, chatId: '42' }), true);
});

test('chat id comparison coerces number vs string', () => {
  assert.equal(ownsJob(tgJob, { channelId: 3, chatId: 42 }), true);
});

test('telegram job does not match another chat or channel', () => {
  assert.equal(ownsJob(tgJob, { channelId: 3, chatId: '43' }), false);
  assert.equal(ownsJob(tgJob, { channelId: 4, chatId: '42' }), false);
});

test('web job matches its own session', () => {
  assert.equal(ownsJob(webJob, { sessionId: 'web-abc' }), true);
});

test('web job does not match a foreign session', () => {
  assert.equal(ownsJob(webJob, { sessionId: 'web-other' }), false);
});

test('telegram job is not owned by a web session context (and vice versa)', () => {
  assert.equal(ownsJob(tgJob, { sessionId: 'web-abc' }), false);
  assert.equal(ownsJob(webJob, { channelId: 3, chatId: '42' }), false);
});

test('telegram context with a sessionId still matches via channel+chat', () => {
  // telegram.js passes channelId, chatId AND the resolved sessionId; the
  // job row itself has session_id null, so ownership comes from the chat.
  assert.equal(ownsJob(tgJob, { channelId: 3, chatId: '42', sessionId: 'tg-session' }), true);
});

test('empty context owns nothing', () => {
  assert.equal(ownsJob(tgJob, {}), false);
  assert.equal(ownsJob(webJob, {}), false);
  assert.equal(ownsJob(webJob, undefined), false);
});
