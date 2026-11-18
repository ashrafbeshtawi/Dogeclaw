// db_run_sql (src/tools/db.js): reads are capped in the query itself, writes
// run as written, and a statement timeout comes back as a clear error — with a
// fake agentQuery, no database.
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const calls = [];
let respond = async () => ({ rows: [], rowCount: 0, command: 'SELECT' });

mock.module('../src/db/pool.js', {
  namedExports: {
    agentQuery: async (sql, params) => { calls.push(sql); return respond(sql, params); },
    AGENT_STATEMENT_TIMEOUT_MS: 30_000,
  },
});

const { register, MAX_ROWS } = await import('../src/tools/db.js');

const handlers = {};
register({ register: (name, _def, fn) => { handlers[name] = fn; } });
const runSql = args => handlers.db_run_sql(args);

const pgError = (code, message = 'boom') => Object.assign(new Error(message), { code });
const rows = n => Array.from({ length: n }, (_, i) => ({ id: i }));

beforeEach(() => {
  calls.length = 0;
  respond = async () => ({ rows: [], rowCount: 0, command: 'SELECT' });
});

test('a SELECT is wrapped with a LIMIT of MAX_ROWS + 1', async () => {
  await runSql({ query: 'SELECT * FROM notes;' });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^SELECT \* FROM \(SELECT \* FROM notes\n\) AS _q LIMIT 101$/);
});

test('a WITH query is wrapped too', async () => {
  await runSql({ query: 'with x as (select 1) select * from x' });
  assert.match(calls[0], /LIMIT 101$/);
});

test('more than MAX_ROWS rows: truncated, rowCount is the returned count', async () => {
  respond = async () => ({ rows: rows(MAX_ROWS + 1), rowCount: MAX_ROWS + 1, command: 'SELECT' });
  const out = await runSql({ query: 'SELECT * FROM big' });
  assert.equal(out.rows.length, MAX_ROWS);
  assert.equal(out.rowCount, MAX_ROWS);
  assert.equal(out.truncated, true);
});

test('writes and multi-statement SQL run as written', async () => {
  await runSql({ query: 'INSERT INTO notes (body) VALUES ($1)', params: ['x'] });
  await runSql({ query: 'SELECT 1; SELECT 2' });
  assert.deepEqual(calls, ['INSERT INTO notes (body) VALUES ($1)', 'SELECT 1; SELECT 2']);
});

test('a wrap the parser rejects falls back to the plain query', async () => {
  const sql = 'WITH d AS (DELETE FROM notes RETURNING id) SELECT * FROM d';
  respond = async q => {
    if (q.includes('AS _q')) throw pgError('0A000', 'WITH clause containing a data-modifying statement must be at the top level');
    return { rows: [{ id: 1 }], rowCount: 1, command: 'SELECT' };
  };
  const out = await runSql({ query: sql });
  assert.equal(calls.length, 2);
  assert.equal(calls[1], sql);
  assert.equal(out.rowCount, 1);
});

test('other errors from the wrapped query are not retried', async () => {
  respond = async () => { throw pgError('42P01', 'relation "nope" does not exist'); };
  await assert.rejects(runSql({ query: 'SELECT * FROM nope' }), /does not exist/);
  assert.equal(calls.length, 1);
});

test('a statement timeout returns a clear error for the model', async () => {
  respond = async () => { throw pgError('57014', 'canceling statement due to statement timeout'); };
  const out = await runSql({ query: 'SELECT pg_sleep(60)' });
  assert.match(out.error, /cancelled after 30s/);
});
