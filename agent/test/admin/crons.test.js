// UNIT: public/admin/crons.js — the view logic behind the cron table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './dom.js';
import { state } from '../../src/web/public/admin/store.js';
import {
  cronFailed, cronTargetKey, cronSortValue, cronMatchesFilter,
  setCronSort, setCronView, renderCrons,
} from '../../src/web/public/admin/crons.js';

test('cronFailed counts only jobs that ran and did not report ok', () => {
  assert.equal(cronFailed({ last_run_at: '2026-01-01T00:00:00Z', last_status: 'error' }), true);
  assert.equal(cronFailed({ last_run_at: '2026-01-01T00:00:00Z', last_status: 'ok' }), false);
  // never run is not a failure — the distinction the Failing tab depends on
  assert.equal(cronFailed({ last_run_at: null, last_status: null }), false);
  assert.equal(cronFailed({}), false);
});

test('cronTargetKey distinguishes telegram from web jobs', () => {
  assert.equal(cronTargetKey({ chat_id: '99', channel_name: 'ops' }), 'tg:ops/99');
  assert.equal(cronTargetKey({ session_id: 'abc' }), 'web:abc');
  assert.equal(cronTargetKey({}), '');
});

test('cronSortValue returns comparable keys per column', () => {
  const job = {
    id: 7, agent_name: 'Ops', prompt: 'Do The Thing', expression: '*/5 * * * *',
    enabled: true, last_run_at: '2026-01-02T03:04:05Z', chat_id: '99', channel_name: 'tg',
  };
  assert.equal(cronSortValue(job, 'id'), 7);
  // lower-cased so sorting is not case-sensitive
  assert.equal(cronSortValue(job, 'agent'), 'ops');
  assert.equal(cronSortValue(job, 'prompt'), 'do the thing');
  assert.equal(cronSortValue(job, 'enabled'), 1);
  assert.equal(cronSortValue(job, 'last'), Date.parse('2026-01-02T03:04:05Z'));
  assert.equal(cronSortValue(job, 'schedule'), '*/5 * * * *');
  assert.equal(cronSortValue(job, 'nope'), 0);
});

test('cronSortValue sorts a never-run job below every job that has run', () => {
  assert.equal(cronSortValue({ last_run_at: null }, 'last'), 0);
});

test('cronSortValue falls back to run_at for one-shots with no expression', () => {
  assert.equal(cronSortValue({ run_at: '2099-01-01' }, 'schedule'), '2099-01-01');
  assert.equal(cronSortValue({}, 'schedule'), '');
});

test('cronMatchesFilter searches every field it claims to', () => {
  const job = {
    agent_name: 'Ops', prompt: 'send the report', description: 'daily digest',
    expression: '0 9 * * *', channel_name: 'alerts', chat_id: '748203222',
    session_id: 'tg-abc', timezone: 'Europe/Berlin',
  };
  assert.equal(cronMatchesFilter(job, ''), true);
  for (const q of ['report', 'digest', '748203222', 'berlin', 'alerts', '0 9']) {
    assert.equal(cronMatchesFilter(job, q), true, `should match ${q}`);
  }
  assert.equal(cronMatchesFilter(job, 'nothing-matches-this'), false);
});

test('cronMatchesFilter skips absent fields instead of matching "undefined"', () => {
  assert.equal(cronMatchesFilter({ prompt: 'x' }, 'undefined'), false);
});

// Three jobs that differ in every axis the view filters on.
const FIXTURE = [
  { id: 1, enabled: true,  agent_id: 1, prompt: 'alpha', expression: '* * * * *', last_run_at: '2026-01-01T00:00:00Z', last_status: 'error' },
  { id: 2, enabled: false, agent_id: 1, prompt: 'bravo', expression: '* * * * *' },
  { id: 3, enabled: true,  agent_id: 2, prompt: 'charlie', expression: '* * * * *', last_run_at: '2026-02-01T00:00:00Z', last_status: 'ok' },
];

function withTable(fn) {
  const dom = installDom();
  state.crons = FIXTURE;
  state.agents = [{ id: 1, name: 'One' }, { id: 2, name: 'Two' }];
  try { return fn(dom, () => dom.el('cronsTable').innerHTML); }
  finally { dom.restore(); state.crons = []; state.agents = []; }
}

test('renderCrons shows the empty state rather than a stale table', () => {
  const dom = installDom();
  state.crons = [];
  try {
    setCronView('all');
    assert.match(dom.el('cronsTable').innerHTML, /No jobs match/);
  } finally { dom.restore(); }
});

test('each view filters to the jobs it names', () => {
  withTable((dom, html) => {
    setCronView('all');
    for (const p of ['alpha', 'bravo', 'charlie']) assert.match(html(), new RegExp(p));

    setCronView('active');
    assert.equal(html().includes('bravo'), false);

    setCronView('inactive');
    assert.match(html(), /bravo/);
    assert.equal(html().includes('alpha'), false);

    // failing = ran and not ok; charlie ran fine, bravo never ran
    setCronView('failing');
    assert.match(html(), /alpha/);
    assert.equal(html().includes('charlie'), false);
    assert.equal(html().includes('bravo'), false);

    setCronView('all');
  });
});

test('the agent dropdown narrows to one agent', () => {
  withTable((dom, html) => {
    setCronView('all');
    dom.el('cronAgentFilter').value = '2';
    renderCrons();
    assert.match(html(), /charlie/);
    assert.equal(html().includes('alpha'), false);
    dom.el('cronAgentFilter').value = '';
    renderCrons();
  });
});

test('setCronSort toggles direction on the same column', () => {
  withTable((dom, html) => {
    setCronView('all');
    setCronSort('id');                       // new column: ascending
    const asc = html();
    assert.ok(asc.indexOf('alpha') < asc.indexOf('charlie'));

    setCronSort('id');                       // same column: flips
    const desc = html();
    assert.ok(desc.indexOf('charlie') < desc.indexOf('alpha'));
  });
});

test('a new sort column resets direction instead of inheriting the last one', () => {
  withTable((dom, html) => {
    setCronView('all');
    setCronSort('prompt');
    setCronSort('prompt');                   // leave it descending
    setCronSort('agent');                    // text column opens ascending
    const byAgent = html();
    assert.ok(byAgent.indexOf('alpha') < byAgent.indexOf('charlie'),
      'agent One should precede agent Two ascending');
  });
});
