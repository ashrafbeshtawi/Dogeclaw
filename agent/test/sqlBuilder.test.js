// Unit tests for the database tool's SQL builders (src/lib/sqlBuilder.js):
// parameterization, identifier escaping (injection surface), and the
// no-where refusal on update/delete.
// Run with: npm test (node --test, stdlib only — no framework, no pg).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeIdent, buildSelect, buildInsert, buildUpdate, buildDelete } from '../src/lib/sqlBuilder.js';

test('escapeIdent quotes and doubles embedded quotes', () => {
  assert.equal(escapeIdent('notes'), '"notes"');
  assert.equal(escapeIdent('we"ird'), '"we""ird"');
  assert.throws(() => escapeIdent(''), /Invalid identifier/);
  assert.throws(() => escapeIdent(undefined), /Invalid identifier/);
});

test('select: bare table gets default limit', () => {
  assert.deepEqual(buildSelect({ table: 'notes' }),
    { text: 'SELECT * FROM "notes" LIMIT $1', params: [20] });
});

test('select: columns, where, order_by, and capped limit', () => {
  assert.deepEqual(
    buildSelect({
      table: 'notes',
      columns: ['topic', 'body'],
      where: { topic: 'health', done: false },
      order_by: 'created_at DESC',
      limit: 500,
    }),
    {
      text: 'SELECT "topic", "body" FROM "notes" WHERE "topic" = $1 AND "done" = $2 ORDER BY "created_at" DESC LIMIT $3',
      params: ['health', false, 100],
    },
  );
});

test('select: order_by rejects anything beyond column + direction', () => {
  assert.throws(() => buildSelect({ table: 't', order_by: 'id; DROP TABLE x' }), /Invalid order_by/);
  assert.throws(() => buildSelect({ table: 't', order_by: 'id LIMIT 1' }), /Invalid order_by/);
});

test('select: injection attempts in identifiers are neutralized by quoting', () => {
  const q = buildSelect({ table: 'a"; DROP TABLE b; --' });
  assert.equal(q.text, 'SELECT * FROM "a""; DROP TABLE b; --" LIMIT $1');
});

test('insert: builds RETURNING * with all values parameterized', () => {
  assert.deepEqual(buildInsert({ table: 'notes', values: { topic: 'health', body: 'x' } }), {
    text: 'INSERT INTO "notes" ("topic", "body") VALUES ($1, $2) RETURNING *',
    params: ['health', 'x'],
  });
  assert.throws(() => buildInsert({ table: 'notes', values: {} }), /requires values/);
});

test('update: numbers params across set and where', () => {
  assert.deepEqual(buildUpdate({ table: 'notes', set: { body: 'y' }, where: { id: 3 } }), {
    text: 'UPDATE "notes" SET "body" = $1 WHERE "id" = $2',
    params: ['y', 3],
  });
});

test('update/delete refuse to run without a where', () => {
  assert.throws(() => buildUpdate({ table: 'notes', set: { body: 'y' } }), /requires where/);
  assert.throws(() => buildUpdate({ table: 'notes', set: {}, where: { id: 1 } }), /requires set/);
  assert.throws(() => buildDelete({ table: 'notes' }), /requires where/);
  assert.throws(() => buildDelete({ table: 'notes', where: {} }), /requires where/);
});

test('delete: builds parameterized where', () => {
  assert.deepEqual(buildDelete({ table: 'notes', where: { id: 7 } }),
    { text: 'DELETE FROM "notes" WHERE "id" = $1', params: [7] });
});
