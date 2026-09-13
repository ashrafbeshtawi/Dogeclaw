// Cron tool handlers (src/lib/cronTools.js): pagination, ownership scoping,
// prompt preview vs full detail, and add validation — with injected fakes,
// no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCronHandlers } from '../src/lib/cronTools.js';

const tgCtx = { agentId: 1, channelId: 5, chatId: '99' };
const job = (id, extra = {}) => ({
  id, channel_id: 5, chat_id: '99', session_id: null,
  expression: '0 9 * * *', run_at: null, timezone: 'UTC',
  description: `job ${id}`, prompt: `prompt ${id}`, enabled: true,
  last_run_at: null, last_status: null, last_error: null, run_count: 0,
  ...extra,
});

function makeDeps(jobs = []) {
  const calls = { deleted: [], created: [], reloads: 0 };
  const deps = {
    listJobs: async () => jobs,
    getJob: async (id) => jobs.find(j => j.id === id) || null,
    createJob: async (args) => { calls.created.push(args); return { id: 42, ...args }; },
    deleteJob: async (id) => { calls.deleted.push(id); },
    getTimezone: async () => 'Europe/Berlin',
    reloadCronJobs: () => { calls.reloads++; },
  };
  return { deps, calls };
}

test('listCrons: only jobs of the calling conversation, paginated with next_offset', async () => {
  const jobs = [
    ...Array.from({ length: 25 }, (_, i) => job(i + 1)),
    job(100, { channel_id: 7 }),                       // foreign channel
    job(101, { channel_id: null, session_id: 'web' }), // foreign session
  ];
  const { deps } = makeDeps(jobs);
  const h = makeCronHandlers(deps);

  const p1 = await h.listCrons({}, tgCtx);
  assert.equal(p1.total, 25);            // the two foreign jobs are invisible
  assert.equal(p1.jobs.length, 20);      // default page size
  assert.equal(p1.next_offset, 20);

  const p2 = await h.listCrons({ offset: p1.next_offset }, tgCtx);
  assert.equal(p2.jobs.length, 5);
  assert.equal(p2.next_offset, undefined);
  assert.deepEqual(p2.jobs.map(j => j.id), [21, 22, 23, 24, 25]);
});

test('listCrons: limit is capped at 50 and floored at 1; offset past the end is empty', async () => {
  const { deps } = makeDeps(Array.from({ length: 60 }, (_, i) => job(i + 1)));
  const h = makeCronHandlers(deps);
  assert.equal((await h.listCrons({ limit: 500 }, tgCtx)).jobs.length, 50);
  assert.equal((await h.listCrons({ limit: -3 }, tgCtx)).jobs.length, 1);
  assert.deepEqual((await h.listCrons({ offset: 999 }, tgCtx)).jobs, []);
});

test('listCrons: long prompts are previewed, get_cron returns them in full', async () => {
  const long = 'x'.repeat(300);
  const { deps } = makeDeps([job(1, { prompt: long })]);
  const h = makeCronHandlers(deps);
  const listed = (await h.listCrons({}, tgCtx)).jobs[0];
  assert.equal(listed.prompt.length, 121); // 120 + ellipsis
  const full = await h.getCron({ id: 1 }, tgCtx);
  assert.equal(full.prompt, long);
});

test('getCron: foreign jobs and unknown ids read as not found; id required', async () => {
  const { deps } = makeDeps([job(1, { channel_id: 7 })]);
  const h = makeCronHandlers(deps);
  assert.match((await h.getCron({ id: 1 }, tgCtx)).error, /not found/);
  assert.match((await h.getCron({ id: 999 }, tgCtx)).error, /not found/);
  assert.match((await h.getCron({}, tgCtx)).error, /id is required/);
});

test('removeCron: deletes owned jobs and reloads; refuses foreign jobs', async () => {
  const { deps, calls } = makeDeps([job(1), job(2, { channel_id: 7 })]);
  const h = makeCronHandlers(deps);

  assert.deepEqual(await h.removeCron({ id: 1 }, tgCtx), { removed: 1 });
  assert.deepEqual(calls.deleted, [1]);
  assert.equal(calls.reloads, 1);

  assert.match((await h.removeCron({ id: 2 }, tgCtx)).error, /not found/);
  assert.deepEqual(calls.deleted, [1]); // untouched
});

test('addCron: binds to the calling conversation and defaults the timezone', async () => {
  const { deps, calls } = makeDeps();
  const h = makeCronHandlers(deps);

  const res = await h.addCron({ expression: '0 8 * * *', prompt: 'wake me' }, tgCtx);
  assert.equal(res.created.id, 42);
  assert.deepEqual(calls.created[0], {
    agentId: 1, channelId: 5, chatId: '99', sessionId: null,
    expression: '0 8 * * *', runAt: null, timezone: 'Europe/Berlin',
    description: '', prompt: 'wake me',
  });

  const web = await h.addCron({ run_at: '2026-10-01T07:00:00Z', prompt: 'p' }, { agentId: 1, sessionId: 'web-1' });
  assert.equal(web.created.sessionId, 'web-1');
  assert.equal(web.created.channelId, null);
});

test('addCron: validation errors before any write', async () => {
  const { deps, calls } = makeDeps();
  const h = makeCronHandlers(deps);
  assert.match((await h.addCron({ expression: '* * * * *' }, tgCtx)).error, /prompt is required/);
  assert.match((await h.addCron({ prompt: 'p' }, {})).error, /no agent/);
  assert.match((await h.addCron({ prompt: 'p' }, { agentId: 1 })).error, /nowhere to deliver/);
  assert.equal(calls.created.length, 0);
});
