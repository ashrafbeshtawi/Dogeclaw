// UNIT: public/admin/events.js — the event log table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './dom.js';
import { state } from '../../src/web/public/admin/store.js';
import { eventPreview, renderEvents } from '../../src/web/public/admin/events.js';

test('eventPreview shows the error for a failed run', () => {
  assert.equal(eventPreview({ status: 'error', error: 'OpenRouter 400', output: 'ignored' }), 'OpenRouter 400');
});

test('eventPreview names the gap when a failure carries no message', () => {
  assert.equal(eventPreview({ status: 'error' }), '(no error message)');
});

test('eventPreview prefers output over input for a successful run', () => {
  assert.equal(eventPreview({ status: 'success', input: 'in', output: 'out' }), 'out');
  assert.equal(eventPreview({ status: 'success', input: 'in' }), 'in');
});

test('eventPreview collapses whitespace so a multi-line prompt stays one row', () => {
  assert.equal(eventPreview({ status: 'success', output: 'a\n\n  b\tc' }), 'a b c');
});

test('eventPreview caps the preview at 80 characters', () => {
  const long = 'x'.repeat(200);
  assert.equal(eventPreview({ status: 'success', output: long }).length, 80);
});

test('eventPreview tolerates a non-string payload', () => {
  assert.equal(eventPreview({ status: 'success', output: 42 }), '42');
  assert.equal(eventPreview({ status: 'success' }), '');
});

test('renderEvents shows the empty state with no rows', () => {
  const dom = installDom();
  state.events = [];
  try {
    renderEvents();
    assert.match(dom.el('eventsTable').innerHTML, /No events yet\./);
    // the string the state rewrite corrupted once; pinned so it cannot regress
    assert.equal(dom.el('eventsTable').innerHTML.includes('state.'), false);
  } finally { dom.restore(); }
});

test('renderEvents lists a row per event with its status', () => {
  const dom = installDom();
  state.events = [
    { id: 1, kind: 'cron_run', status: 'error', ref_id: 96, duration_ms: 115624, error: 'boom', created_at: '2026-09-16T10:01:56Z' },
    { id: 2, kind: 'cron_run', status: 'success', ref_id: 97, duration_ms: 12, output: 'fine', created_at: '2026-09-16T10:02:00Z' },
  ];
  try {
    renderEvents();
    const html = dom.el('eventsTable').innerHTML;
    assert.match(html, /error/);
    assert.match(html, /success/);
    assert.match(html, /boom/);
    assert.match(html, /fine/);
  } finally { dom.restore(); state.events = []; }
});
