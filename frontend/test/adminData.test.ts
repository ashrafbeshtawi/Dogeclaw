import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countCronViews, cronAgents, cronMatchesFilter, cronSortValue, cronTargetKey, eventPreview,
  isCronFailed, keyValueLines, maskKey, nextCronSort, parseKeyValueLines, selectCrons, toAdminData, DEFAULT_CRON_SORT,
} from '../src/pages/admin/data.ts';
import { listOf } from '../src/api.ts';

test('listOf returns the array, or [] for an error body or a missing key', () => {
  assert.deepEqual(listOf({ agents: [{ id: 1 }] }, 'agents'), [{ id: 1 }]);
  assert.deepEqual(listOf({ error: 'db down' }, 'agents'), []);
  assert.deepEqual(listOf(null, 'agents'), []);
  assert.deepEqual(listOf({ agents: 'nope' }, 'agents'), []);
});

test('toAdminData keeps the other tabs when one boot request failed', () => {
  const ok = [
    { models: [{ id: 1 }] }, { error: 'agents exploded' }, { channels: [] }, { skills: [] }, { base_url: 'x' },
    { jobs: [] }, { sessions: [] }, { error: 'settings exploded' }, { servers: [] }, { engines: [{ id: 2 }], providers: ['brave'] },
  ];
  const data = toAdminData(ok);
  assert.deepEqual(data.models, [{ id: 1 }]);
  assert.deepEqual(data.agents, []);
  assert.deepEqual(data.settings, {});
  assert.deepEqual(data.siteConfig, { base_url: 'x' });
  assert.deepEqual(data.searchEngines, [{ id: 2 }]);
  assert.deepEqual(data.searchProviders, ['brave']);
  for (const key of ['models', 'agents', 'channels', 'skills', 'crons', 'sessions', 'mcpServers', 'searchEngines', 'searchProviders'] as const) {
    assert.ok(Array.isArray(toAdminData(Array(10).fill({ error: 'down' }))[key]), key);
  }
});

const job = (fields: Record<string, unknown>) => ({ id: 1, enabled: true, ...fields });

test('isCronFailed counts only jobs that ran and did not report ok', () => {
  assert.equal(isCronFailed(job({})), false);
  assert.equal(isCronFailed(job({ last_run_at: '2026-01-01', last_status: 'ok' })), false);
  assert.equal(isCronFailed(job({ last_run_at: '2026-01-01', last_status: 'error' })), true);
});

test('cronTargetKey distinguishes telegram from web jobs', () => {
  assert.equal(cronTargetKey(job({ chat_id: '5', channel_name: 'bot' })), 'tg:bot/5');
  assert.equal(cronTargetKey(job({ session_id: 'abc' })), 'web:abc');
  assert.equal(cronTargetKey(job({})), '');
});

test('cronSortValue sorts a never-run job below every job that has run', () => {
  assert.equal(cronSortValue(job({}), 'last'), 0);
  assert.ok((cronSortValue(job({ last_run_at: '2026-01-01' }), 'last') as number) > 0);
});

test('cronSortValue falls back to run_at for one-shots with no expression', () => {
  assert.equal(cronSortValue(job({ run_at: '2099-01-01' }), 'schedule'), '2099-01-01');
});

test('cronMatchesFilter searches every field it claims to', () => {
  const j = job({
    agent_name: 'Ops', prompt: 'send the report', description: 'daily digest', expression: '0 9 * * *',
    channel_name: 'alerts', chat_id: '748203222', session_id: 'tg-abc', timezone: 'Europe/Berlin',
  });
  for (const q of ['', 'report', 'digest', '748203222', 'berlin', 'alerts']) assert.equal(cronMatchesFilter(j, q), true, q);
  assert.equal(cronMatchesFilter(j, 'nothing-matches-this'), false);
});

test('cronMatchesFilter skips absent fields instead of matching "undefined"', () => {
  assert.equal(cronMatchesFilter(job({ prompt: 'ping' }), 'undefined'), false);
  assert.equal(cronMatchesFilter(job({ prompt: 'Morning ping' }), 'morning'), true);
});

test('nextCronSort flips the same column and resets direction on a new one', () => {
  assert.deepEqual(nextCronSort({ key: 'id', dir: 'asc' }, 'id'), { key: 'id', dir: 'desc' });
  assert.deepEqual(nextCronSort({ key: 'id', dir: 'desc' }, 'prompt'), { key: 'prompt', dir: 'asc' });
  assert.deepEqual(nextCronSort({ key: 'id', dir: 'asc' }, 'last'), { key: 'last', dir: 'desc' });
});

test('selectCrons filters by view and agent, and puts enabled jobs first by default', () => {
  const crons = [
    job({ id: 1, enabled: false, agent_id: 1 }),
    job({ id: 2, enabled: true, agent_id: 2 }),
    job({ id: 3, enabled: true, agent_id: 1, last_run_at: '2026-01-01', last_status: 'error' }),
  ];
  assert.deepEqual(selectCrons(crons, 'all', '', '', DEFAULT_CRON_SORT).map((j) => j.id), [2, 3, 1]);
  assert.deepEqual(selectCrons(crons, 'inactive', '', '', DEFAULT_CRON_SORT).map((j) => j.id), [1]);
  assert.deepEqual(selectCrons(crons, 'failing', '', '', DEFAULT_CRON_SORT).map((j) => j.id), [3]);
  assert.deepEqual(selectCrons(crons, 'all', '1', '', DEFAULT_CRON_SORT).map((j) => j.id), [3, 1]);
  assert.deepEqual(countCronViews(crons), { all: 3, active: 2, inactive: 1, failing: 1 });
});

test('cronAgents lists each job owner once, by name', () => {
  const agents = cronAgents([job({ agent_id: 2, agent_name: 'b' }), job({ agent_id: 1, agent_name: 'a' }), job({ agent_id: 2, agent_name: 'b' })]);
  assert.deepEqual(agents, [{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);
});

test('eventPreview shows the error for a failed run and names a missing one', () => {
  assert.equal(eventPreview({ id: 1, status: 'error', error: 'boom' }), 'boom');
  assert.equal(eventPreview({ id: 1, status: 'error' }), '(no error message)');
});

test('eventPreview prefers output, collapses whitespace and caps at 80 characters', () => {
  assert.equal(eventPreview({ id: 1, status: 'success', input: 'in', output: 'a\n\n b' }), 'a b');
  assert.equal(eventPreview({ id: 1, status: 'success', output: 'x'.repeat(100) }).length, 80);
});

test('parseKeyValueLines splits on the first = and ignores malformed lines', () => {
  assert.deepEqual(parseKeyValueLines('A = 1\nB=x=y\n\n=z\nnope'), { A: '1', B: 'x=y' });
  assert.equal(keyValueLines({ A: '1', B: '2' }), 'A=1\nB=2');
});

test('maskKey shows long keys only by their ends', () => {
  assert.equal(maskKey('abcdefghijkl'), 'abcd…ijkl');
  assert.equal(maskKey('short'), 'short');
});
