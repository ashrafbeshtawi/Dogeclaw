// Unit tests for periodic response mode in TelegramManager
// (src/channels/telegram.js #processQueue): a queued batch is answered in the
// chat's session with its history, images, persisted rows and a retry.
// The bot library, DB modules and retry delays are replaced in memory.
// Run with: npm test (node --test, stdlib only — no framework).

import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

let channelRows = [];
let queue = [];
let sessions = new Map();
const sent = [];

class FakeBot extends EventEmitter {
  constructor(token) { super(); this.token = token; }
  async stopPolling() {}
  async setMyCommands() {}
  async sendChatAction() {}
  async sendMessage(chatId, text) { sent.push({ chatId: String(chatId), text }); }
}

mock.module('node-telegram-bot-api', { defaultExport: FakeBot });
mock.module('../src/db/pool.js', { namedExports: { adminQuery: async () => ({ rows: channelRows }) } });
mock.module('../src/db/queue.js', {
  namedExports: {
    enqueue: async () => {},
    claimBatch: async channelId => {
      const mine = queue.filter(q => q.channel_id === channelId);
      queue = queue.filter(q => q.channel_id !== channelId);
      return mine;
    },
  },
});
mock.module('../src/db/sessions.js', {
  namedExports: {
    loadSession: async id => ({ messages: structuredClone(sessions.get(id) || []) }),
    ensureSession: async id => { if (!sessions.has(id)) sessions.set(id, []); },
    appendMessage: async (id, row) => { sessions.get(id).push(row); },
    resetSession: async () => {},
    findActiveTelegramSession: async () => null,
  },
});
mock.module('../src/db/crons.js', { namedExports: { listJobs: async () => [], getJob: async () => null, deleteJob: async () => {} } });
// Same contract as src/lib/retry.js (three attempts), without the real waits.
mock.module('../src/lib/retry.js', {
  namedExports: {
    runWithRetry: async (fn, opts = {}) => {
      for (let attempt = 1; ; attempt++) {
        try { return await fn(attempt); } catch (err) {
          if (attempt >= 3) throw err;
          opts.onRetry?.(err, attempt);
        }
      }
    },
  },
});

const { TelegramManager } = await import('../src/channels/telegram.js');

const channel = (overrides = {}) => ({
  id: 7, name: 'doge', type: 'telegram', enabled: true, token: 'tok', webhook_id: 'w7',
  agent_id: 3, agent_name: 'Doge', system_prompt: 'be nice',
  response_mode: 'periodic', response_interval: '1m',
  model_id: 'm', base_url: 'http://x', think: false, accepts: ['text', 'image'], provider: 'ollama', api_key: null,
  ...overrides,
});

const queued = (id, text, images = null) => ({ id, channel_id: 7, chat_id: '100', user_id: '5', text, images, created_at: new Date() });

function fakeAgent(impl) {
  const calls = [];
  return {
    calls,
    run: async (text, history, opts) => {
      calls.push({ text, history: structuredClone(history), opts });
      return impl(calls.length);
    },
  };
}

// Starts the manager, fires one periodic tick and waits for it to finish.
async function runOneTick(agent) {
  mock.timers.enable({ apis: ['setInterval'] });
  const manager = new TelegramManager(agent);
  try {
    await manager.start(null);
    mock.timers.tick(60_000);
    for (let i = 0; i < 50; i++) await new Promise(r => setImmediate(r));
  } finally {
    manager.stop();
    mock.timers.reset();
  }
}

beforeEach(() => {
  channelRows = [channel()];
  queue = [];
  sessions = new Map();
  sent.length = 0;
});

test('a queued batch gets the chat history, session id and images', async () => {
  sessions.set('tg-doge-100', [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'hi' }]);
  queue = [queued(2, 'second', ['img2']), queued(1, 'first', ['img1'])];
  const agent = fakeAgent(() => ({ content: 'answer' }));

  await runOneTick(agent);

  assert.equal(agent.calls.length, 1);
  const [call] = agent.calls;
  assert.equal(call.text, 'first\n---\nsecond');
  assert.deepEqual(call.history.map(m => m.content), ['earlier', 'hi']);
  assert.equal(call.opts.sessionId, 'tg-doge-100');
  assert.deepEqual(call.opts.images, ['img1', 'img2']);
  assert.equal(call.opts.mediaHints, undefined);
  assert.deepEqual(sent, [{ chatId: '100', text: 'answer' }]);
});

test('the queued messages and the reply are saved to the session', async () => {
  queue = [queued(1, 'hello', ['img1']), queued(2, 'again')];
  await runOneTick(fakeAgent(() => ({ content: 'answer', thinking: 'hmm' })));

  const rows = sessions.get('tg-doge-100');
  assert.deepEqual(rows.map(r => [r.role, r.content]), [['user', 'hello'], ['user', 'again'], ['assistant', 'answer']]);
  assert.equal(rows[0].hasImage, true);
  assert.equal(rows[1].hasImage, false);
  assert.equal(rows[2].thinking, 'hmm');
});

test('images become an [Attached: image] hint when the model no longer accepts them', async () => {
  channelRows = [channel({ accepts: ['text'] })];
  queue = [queued(1, 'look', ['img1'])];
  const agent = fakeAgent(() => ({ content: 'ok' }));

  await runOneTick(agent);

  assert.equal(agent.calls[0].opts.images, undefined);
  assert.deepEqual(agent.calls[0].opts.mediaHints, ['image']);
});

test('a transient model failure is retried and answered once', async () => {
  queue = [queued(1, 'hello')];
  const agent = fakeAgent(n => { if (n === 1) throw new Error('upstream 503'); return { content: 'second try' }; });

  await runOneTick(agent);

  assert.equal(agent.calls.length, 2);
  assert.deepEqual(sent, [{ chatId: '100', text: 'second try' }]);
  assert.deepEqual(sessions.get('tg-doge-100').map(r => r.role), ['user', 'assistant']);
});

test('when every attempt fails the user rows are kept and the user is told', async () => {
  queue = [queued(1, 'hello')];
  await runOneTick(fakeAgent(() => { throw new Error('provider down'); }));

  assert.deepEqual(sessions.get('tg-doge-100').map(r => [r.role, r.content]), [['user', 'hello']]);
  assert.deepEqual(sent, [{ chatId: '100', text: 'Error: provider down' }]);
});
