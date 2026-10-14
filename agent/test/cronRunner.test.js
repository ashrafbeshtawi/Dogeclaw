// Unit tests for CronRunner's tick (src/cron/runner.js): planning, claiming
// and starting due runs. db/crons.js is replaced by an in-memory table whose
// claimDueRun is the same compare-and-set as the SQL, so these tests cover
// the runner's use of it; the SQL itself is covered by tests/specs/crons.spec.js.
// Run with: npm test (node --test, stdlib only — no framework).

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { CronExpressionParser } from 'cron-parser';

let rows = [];
const startedRuns = [];

const copyRow = row => structuredClone(row);

mock.module('../src/db/crons.js', {
  namedExports: {
    computeNextCronRun: (expression, tz, from) =>
      CronExpressionParser.parse(expression, { tz, currentDate: from }).next().toDate(),
    findUnscheduledJobs: async () => rows.filter(r => r.enabled && !r.nextRunAt).map(copyRow),
    planNextRun: async (job, nextRunAt) => {
      const row = rows.find(r => r.id === job.id);
      if (!row.nextRunAt) row.nextRunAt = nextRunAt;
    },
    findDueJobs: async () => rows.filter(r => r.enabled && r.nextRunAt <= new Date()).map(copyRow),
    claimDueRun: async (job, nextRunAt) => {
      await new Promise(r => setImmediate(r));
      const row = rows.find(r => r.id === job.id);
      if (!row.enabled || row.nextRunAt?.getTime() !== job.nextRunAt.getTime()) return null;
      row.nextRunAt = nextRunAt;
      row.enabled = row.enabled && row.schedule.kind === 'recurring';
      return copyRow(row);
    },
    // Every started run ends here: the mocked agent runtime is missing, so
    // the run fails its setup and records the error.
    recordRun: async id => { startedRuns.push(id); },
  },
});
mock.module('../src/db/sessions.js', {
  namedExports: { loadSession: async () => {}, ensureSession: async () => {}, appendMessage: async () => {}, findActiveTelegramSession: async () => null },
});
mock.module('../src/db/agentRuntime.js', { namedExports: { loadAgentRuntime: async () => null } });
mock.module('../src/db/pool.js', { namedExports: { adminQuery: async () => ({ rows: [] }) } });
mock.module('../src/db/eventLogs.js', { namedExports: { insertEventLog: async () => {} } });

const { CronRunner } = await import('../src/cron/runner.js');

const MINUTE = 60_000;
const minutesAgo = n => new Date(Date.now() - n * MINUTE);

const recurring = expression => ({ kind: 'recurring', expression });
const oneShot = runAt => ({ kind: 'oneShot', runAt });

function makeJob(overrides) {
  return {
    enabled: true, timezone: 'Europe/Berlin', nextRunAt: null, updatedAt: new Date(), runCount: 0,
    target: { kind: 'session', sessionId: 'web-1' },
    ...overrides,
  };
}

// One tick: start() runs it immediately; stop() clears the interval.
async function runOneTick() {
  const runner = new CronRunner(null, null);
  await runner.start();
  runner.stop();
  await new Promise(r => setTimeout(r, 20));
}

function resetTable(jobs) {
  rows = jobs;
  startedRuns.length = 0;
}

test('plans recurring jobs from updated_at and one-shots at run_at', async () => {
  const runAt = new Date(Date.now() + 60 * MINUTE);
  const updatedAt = new Date();
  resetTable([
    makeJob({ id: 1, schedule: recurring('0 10 * * *'), updatedAt }),
    makeJob({ id: 2, schedule: oneShot(runAt) }),
  ]);
  await runOneTick();
  const expected = CronExpressionParser.parse('0 10 * * *', { tz: 'Europe/Berlin', currentDate: updatedAt }).next().toDate();
  assert.equal(rows[0].nextRunAt.getTime(), expected.getTime());
  assert.equal(rows[1].nextRunAt.getTime(), runAt.getTime());
  assert.deepEqual(startedRuns, []);
});

test('a due run starts once when two runners tick at the same time', async () => {
  resetTable([makeJob({ id: 1, schedule: recurring('0 10 * * *'), nextRunAt: minutesAgo(1) })]);
  await Promise.all([runOneTick(), runOneTick()]);
  assert.deepEqual(startedRuns, [1]);
  assert.ok(rows[0].nextRunAt > new Date());
});

test('a one-shot is disabled by its claim and never starts again', async () => {
  resetTable([makeJob({ id: 1, schedule: oneShot(minutesAgo(1)), nextRunAt: minutesAgo(1) })]);
  await runOneTick();
  await runOneTick();
  assert.deepEqual(startedRuns, [1]);
  assert.equal(rows[0].enabled, false);
});

test('late runs start once, however late, and a recurring job moves on from now', async () => {
  resetTable([
    makeJob({ id: 1, schedule: oneShot(minutesAgo(120)), nextRunAt: minutesAgo(120) }),
    makeJob({ id: 2, schedule: recurring('*/5 * * * *'), nextRunAt: minutesAgo(3 * 24 * 60) }),
  ]);
  await runOneTick();
  await runOneTick();
  assert.deepEqual(startedRuns.sort(), [1, 2]);
  assert.ok(rows[1].nextRunAt > new Date(), 'missed slots are not replayed');
});
