// Unit tests for CronRunner.reload() (src/cron/runner.js): overlapping
// reloads leave exactly one running task per job, tasks recover a match
// their clock check landed late on, and a failed job read keeps the
// current schedule.
// Run with: npm test (node --test, stdlib only — no framework).

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const scheduled = [];
const jobs = [{ id: 1, expression: '0 10 * * *' }, { id: 2, expression: '0 17 * * *' }];
let isListFailing = false;

mock.module('node-cron', {
  defaultExport: {
    validate: () => true,
    schedule: (expression, fn, options) => {
      const task = { expression, options, isRunning: true, stop() { this.isRunning = false; } };
      scheduled.push(task);
      return task;
    },
  },
});
mock.module('../src/db/crons.js', {
  namedExports: {
    listEnabledJobs: async () => {
      await new Promise(r => setTimeout(r, 5));
      if (isListFailing) throw new Error('db down');
      return jobs;
    },
    getJob: async () => null,
    recordRun: async () => {},
    disableJob: async () => {},
    findDueOneShots: async () => [],
  },
});
mock.module('../src/db/settings.js', { namedExports: { getTimezone: async () => 'Europe/Berlin' } });
mock.module('../src/db/sessions.js', {
  namedExports: { loadSession: async () => {}, ensureSession: async () => {}, appendMessage: async () => {}, findActiveTelegramSession: async () => null },
});
mock.module('../src/db/agentRuntime.js', { namedExports: { loadAgentRuntime: async () => null } });
mock.module('../src/db/pool.js', { namedExports: { adminQuery: async () => ({ rows: [] }) } });
mock.module('../src/db/eventLogs.js', { namedExports: { insertEventLog: async () => {} } });

const { CronRunner } = await import('../src/cron/runner.js');
const countRunning = () => scheduled.filter(t => t.isRunning).length;

test('overlapping reloads leave one running task per job', async () => {
  const runner = new CronRunner(null, null);
  await Promise.all([runner.reload(), runner.reload(), runner.reload()]);
  assert.equal(countRunning(), 2);
  runner.stop();
});

test('tasks recover a match their clock check landed late on', async () => {
  const runner = new CronRunner(null, null);
  await runner.reload();
  assert.equal(scheduled.at(-1).options.recoverMissedExecutions, true);
  runner.stop();
});

test('a failed job read keeps the current schedule', async () => {
  const runner = new CronRunner(null, null);
  await runner.reload();
  isListFailing = true;
  await runner.reload();
  isListFailing = false;
  assert.equal(countRunning(), 2);
  runner.stop();
});
