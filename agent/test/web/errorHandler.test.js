// UNIT: src/web/errorHandler.js — the JSON error middleware.
//
// Runs a real express app so the Express 5 promise-rejection path is part of
// what is asserted, not just the function body: a handler that throws must
// reach the middleware and come back as JSON, never as the default HTML page.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { jsonErrorHandler } from '../../src/web/errorHandler.js';

const pgError = (code, detail) => Object.assign(new Error('pg says no'), { code, detail });

let server, base;
const silenced = [];

before(async () => {
  const app = express();
  app.get('/unique', async () => { throw pgError('23505', 'Key (name)=(x) already exists.'); });
  app.get('/fk', async () => { throw pgError('23503', 'Key (id)=(1) is still referenced from table "channels".'); });
  app.get('/bad-id', async () => { throw pgError('22P02'); });
  app.get('/boom', async () => { throw new Error('secret internals'); });
  app.get('/streamed', (req, res) => { res.write('partial'); throw new Error('mid-stream'); });
  app.use(jsonErrorHandler);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const get = async path => {
  const r = await fetch(`${base}${path}`);
  return { status: r.status, type: r.headers.get('content-type'), body: await r.text() };
};

test('unique violation is a 409 carrying pg detail', async () => {
  const r = await get('/unique');
  assert.equal(r.status, 409);
  assert.deepEqual(JSON.parse(r.body), { error: 'Key (name)=(x) already exists.' });
});

test('foreign key violation is a 409', async () => {
  const r = await get('/fk');
  assert.equal(r.status, 409);
  assert.match(JSON.parse(r.body).error, /still referenced/);
});

test('invalid text representation is a 400, falling back to the message', async () => {
  const r = await get('/bad-id');
  assert.equal(r.status, 400);
  assert.deepEqual(JSON.parse(r.body), { error: 'pg says no' });
});

test('anything else is a 500 that is logged and does not leak the message', async () => {
  const original = console.error;
  console.error = (...a) => silenced.push(a.join(' '));
  let r;
  try { r = await get('/boom'); } finally { console.error = original; }
  assert.equal(r.status, 500);
  assert.match(r.type, /application\/json/);
  assert.deepEqual(JSON.parse(r.body), { error: 'internal error' });
  assert.equal(silenced.length, 1);
  assert.match(silenced[0], /GET \/boom.*secret internals/s);
});

test('a throw after headers went out is left to the default handler', async () => {
  // The chat route streams SSE; once bytes are on the wire a JSON body would
  // corrupt the stream, so the middleware steps aside and the socket closes.
  const r = await get('/streamed').catch(e => ({ status: 'aborted', body: '' }));
  assert.notEqual(r.status, 500);
  assert.doesNotMatch(r.body, /internal error/);
});
