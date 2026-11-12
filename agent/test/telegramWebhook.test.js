// UNIT: TelegramManager in webhook mode (src/channels/telegram.js).
//
// One /webhook/:webhookId route is mounted once and hands each update to the
// bot that is live for that channel right now. A disabled channel must stop
// answering, and after a token rotation the new bot (not the old one) must
// handle updates. node-telegram-bot-api, express and the DB are fakes.
// Run with: npm test (node --test, stdlib only — no framework).

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.DOGECLAW_TELEGRAM_MODE = 'webhook';
process.env.DOGECLAW_WEBHOOK_URL = 'https://bot.example.test';

let rows = [];
const bots = [];

class FakeBot {
  constructor(token) {
    this.token = token;
    this.handlers = {};
    this.sent = [];
    this.webhookSet = null;
    this.webhookDeleted = false;
    bots.push(this);
  }
  on(event, fn) { this.handlers[event] = fn; }
  processUpdate(update) { if (update.message) this.handlers.message?.(update.message); }
  async sendMessage(chatId, text) { this.sent.push({ chatId, text }); }
  async sendChatAction() {}
  async setWebHook(url) { this.webhookSet = url; }
  async deleteWebHook() { this.webhookDeleted = true; }
  async stopPolling() {}
  async setMyCommands() {}
}

mock.module('node-telegram-bot-api', { defaultExport: FakeBot });
mock.module('../src/db/pool.js', { namedExports: { adminQuery: async () => ({ rows: rows.map(r => ({ ...r })) }) } });
mock.module('../src/db/sessions.js', {
  namedExports: {
    loadSession: async () => ({ messages: [] }), ensureSession: async () => {}, appendMessage: async () => {},
    resetSession: async () => {}, findActiveTelegramSession: async () => null,
  },
});
mock.module('../src/db/crons.js', { namedExports: { listJobs: async () => [], getJob: async () => null, deleteJob: async () => {} } });
mock.module('../src/db/queue.js', { namedExports: { enqueue: async () => {}, claimBatch: async () => [] } });
mock.module('../src/db/agentRuntime.js', { namedExports: { toModelConfig: () => ({}) } });

const { TelegramManager } = await import('../src/channels/telegram.js');

function channel(overrides) {
  return {
    id: 1, name: 'main', type: 'telegram', enabled: true, token: 'token-a', webhook_id: 'hook-1',
    agent_id: 1, agent_name: 'Doge', allowed_users: null, response_mode: 'immediate', accepts: ['text'],
    ...overrides,
  };
}

function fakeApp() {
  const routes = [];
  return {
    routes,
    post(path, fn) { routes.push({ path, fn }); },
    // Same shape Express hands the route: params from the path, JSON body.
    async deliver(webhookId, text) {
      let status = null;
      const route = routes.find(r => r.path === '/webhook/:webhookId');
      route.fn(
        { params: { webhookId }, body: { update_id: 1, message: { message_id: 1, from: { id: 7 }, chat: { id: 7 }, text } } },
        { sendStatus(code) { status = code; } },
      );
      await new Promise(r => setImmediate(r));
      return status;
    },
  };
}

async function startManager(app) {
  bots.length = 0;
  const agent = { run: async () => ({ content: 'reply' }) };
  const tm = new TelegramManager(agent);
  await tm.start(app);
  return tm;
}

test('a live channel answers updates on its webhook path', async () => {
  rows = [channel()];
  const app = fakeApp();
  const tm = await startManager(app);

  assert.equal(await app.deliver('hook-1', '/start'), 200);
  assert.equal(bots.length, 1);
  assert.equal(bots[0].webhookSet, 'https://bot.example.test/webhook/hook-1');
  assert.equal(bots[0].sent.length, 1);
  assert.match(bots[0].sent[0].text, /DogeClaw \(Doge\)/);
  tm.stop();
});

test('a disabled channel stops answering and its webhook is deleted', async () => {
  rows = [channel()];
  const app = fakeApp();
  const tm = await startManager(app);

  rows = [];
  await tm.reload();

  assert.equal(await app.deliver('hook-1', '/start'), 200);
  assert.equal(bots[0].sent.length, 0);
  assert.equal(bots[0].webhookDeleted, true);
  tm.stop();
});

test('after a token rotation the new bot handles updates, not the old one', async () => {
  rows = [channel({ token: 'token-old' })];
  const app = fakeApp();
  const tm = await startManager(app);

  rows = [channel({ token: 'token-new' })];
  await tm.reload();

  assert.equal(await app.deliver('hook-1', '/start'), 200);
  const [oldBot, newBot] = bots;
  assert.equal(oldBot.token, 'token-old');
  assert.equal(newBot.token, 'token-new');
  assert.equal(oldBot.sent.length, 0);
  assert.equal(newBot.sent.length, 1);
  assert.equal(oldBot.webhookDeleted, true);
  assert.equal(newBot.webhookSet, 'https://bot.example.test/webhook/hook-1');
  tm.stop();
});

test('a stopped bot ignores an update that still reaches it', async () => {
  rows = [channel()];
  const app = fakeApp();
  const tm = await startManager(app);
  const stale = bots[0];

  rows = [];
  await tm.reload();
  stale.processUpdate({ message: { message_id: 2, from: { id: 7 }, chat: { id: 7 }, text: '/start' } });
  await new Promise(r => setImmediate(r));

  assert.equal(stale.sent.length, 0);
  tm.stop();
});

test('reloads never mount a second webhook route', async () => {
  rows = [channel()];
  const app = fakeApp();
  const tm = await startManager(app);

  rows = [];
  await tm.reload();
  rows = [channel()];
  await tm.reload();

  assert.equal(app.routes.length, 1);
  assert.equal(await app.deliver('hook-1', '/start'), 200);
  assert.equal(bots.at(-1).sent.length, 1);
  tm.stop();
});

test('an unknown webhook path gets a 200 and reaches no bot', async () => {
  rows = [channel()];
  const app = fakeApp();
  const tm = await startManager(app);

  assert.equal(await app.deliver('nope', '/start'), 200);
  assert.equal(bots[0].sent.length, 0);
  tm.stop();
});
