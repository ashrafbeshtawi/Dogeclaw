// Unit tests for the DB row text trimmer (src/lib/trimTextFields.js):
// long string values get cut with a continuation marker so all rows survive
// the tool-result size cap; everything else passes through untouched.
// Run with: npm test (node --test, stdlib only — no framework).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trimTextFields } from '../src/lib/trimTextFields.js';

test('trimTextFields: long strings are cut with a marker', () => {
  const rows = trimTextFields([{ body: 'x'.repeat(600), topic: 'health' }], 500);
  assert.equal(rows[0].body, `${'x'.repeat(500)}…[+100 chars]`);
  assert.equal(rows[0].topic, 'health');
});

test('trimTextFields: short strings and non-strings pass through', () => {
  const row = { id: 7, done: true, note: 'short', when: null };
  assert.deepEqual(trimTextFields([row]), [row]);
});

test('trimTextFields: non-array and undefined input pass through', () => {
  assert.equal(trimTextFields(undefined), undefined);
  assert.equal(trimTextFields(null), null);
});
