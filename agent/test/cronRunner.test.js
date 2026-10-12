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

const copyRow = row => ({ ...row });

mock.module('../src/db/crons.js', {
  namedExports: {
    computeNextCronRun: (expression, tz, from) =>
      CronExpressionParser.parse(expression, { tz, currentDate: from }).next().toDate(),
    findUnscheduledJobs: async () => rows.filter(r => r.enabled && !r.next_run_at).map(copyRow),
    planNextRun: async (job, nextRunAt) => {
      const row = rows.find(r => r.id === job.id);
      if (!row.next_run_at) row.next_run_at = nextRunAt;
    },
    findDueJobs: async () => rows.filter(r => r.enabled && r.next_run_at <= new Date()).map(copyRow),
    claimDueRun: async (job, nextRunAt) => {
      await new Promise(r => setImmediate(r));
      const row = rows.find(r => r.id === job.id);
      if (!row.enabled || row.next_run_at?.getTime() !== job.next_run_at.getTime()) return null;
      row.next_run_at = nextRunAt;
      row.enabled = row.enabled && !row.run_at;
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

function makeJob(overrides) {
  return { enabled: true, expression: null, run_at: null, timezone: 'Europe/Berlin', next_run_at: null, updated_at: new Date(), ...overrides };
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
    makeJob({ id: 1, expression: '0 10 * * *', updated_at: updatedAt }),
    makeJob({ id: 2, run_at: runAt }),
  ]);
  await runOneTick();
  const expected = CronExpressionParser.parse('0 10 * * *', { tz: 'Europe/Berlin', currentDate: updatedAt }).next().toDate();
  assert.equal(rows[0].next_run_at.getTime(), expected.getTime());
  assert.equal(rows[1].next_run_at.getTime(), runAt.getTime());
  assert.deepEqual(startedRuns, []);
});

test('a due run starts once when two runners tick at the same time', async () => {
  resetTable([makeJob({ id: 1, expression: '0 10 * * *', next_run_at: minutesAgo(1) })]);
  await Promise.all([runOneTick(), runOneTick()]);
  assert.deepEqual(startedRuns, [1]);
  assert.ok(rows[0].next_run_at > new Date());
});

test('a one-shot is disabled by its claim and never starts again', async () => {
  resetTable([makeJob({ id: 1, run_at: minutesAgo(1), next_run_at: minutesAgo(1) })]);
  await runOneTick();
  await runOneTick();
  assert.deepEqual(startedRuns, [1]);
  assert.equal(rows[0].enabled, false);
});

test('a late one-shot still starts; a recurring run found too late is skipped', async () => {
  resetTable([
    makeJob({ id: 1, run_at: minutesAgo(120), next_run_at: minutesAgo(120) }),
    makeJob({ id: 2, expression: '0 10 * * *', next_run_at: minutesAgo(16) }),
    makeJob({ id: 3, expression: '0 17 * * *', next_run_at: minutesAgo(14) }),
  ]);
  await runOneTick();
  assert.deepEqual(startedRuns.sort(), [1, 3]);
  assert.ok(rows[1].next_run_at > new Date(), 'the skipped job moves on to its next slot');
});
