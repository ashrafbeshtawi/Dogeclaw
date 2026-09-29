// src/llm/transport.js — the HTTP and streaming plumbing every provider shares.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertOk, parseFrame, readLines } from '../../src/llm/transport.js';

test('assertOk passes an ok response through silently', async () => {
  await assertOk(new Response('{}', { status: 200 }), 'X');
});

test('assertOk names the provider and status', async () => {
  await assert.rejects(
    () => assertOk(new Response('nope', { status: 429 }), 'OpenRouter'),
    /^Error: OpenRouter 429: nope$/,
  );
});

test('assertOk keeps a long validation body readable', async () => {
  // The whole reason this exists: a 200-char cap cut provider validation
  // errors off mid-field and made the event log useless.
  const body = JSON.stringify({ error: { message: 'x'.repeat(600) } });
  await assert.rejects(
    () => assertOk(new Response(body, { status: 400 }), 'OpenRouter'),
    err => {
      assert.ok(err.message.length > 600, `truncated to ${err.message.length}`);
      assert.ok(!err.message.includes('more chars'), 'should not be marked truncated');
      return true;
    },
  );
});

test('assertOk marks the cut explicitly when a body really is huge', async () => {
  await assert.rejects(
    () => assertOk(new Response('y'.repeat(5000), { status: 500 }), 'Ollama'),
    err => {
      assert.match(err.message, /…\[3000 more chars\]$/);
      return true;
    },
  );
});

test('assertOk survives an unreadable body', async () => {
  const res = { ok: false, status: 502, text: () => Promise.reject(new Error('socket died')) };
  await assert.rejects(() => assertOk(res, 'Google'), /Google 502: <unreadable response body>/);
});

test('parseFrame returns the parsed object', () => {
  assert.deepEqual(parseFrame('{"a":1}', 'X'), { a: 1 });
});

test('parseFrame logs and returns null instead of throwing', () => {
  // A malformed frame must be distinguishable from no frame, but must not
  // abandon a response that is otherwise arriving fine.
  const warns = [];
  const original = console.warn;
  console.warn = msg => warns.push(msg);
  try {
    assert.equal(parseFrame('{not json', 'Ollama'), null);
  } finally { console.warn = original; }
  assert.equal(warns.length, 1);
  assert.match(warns[0], /Ollama.*unparseable stream frame \(9 chars\)/);
});

test('readLines yields complete lines and drops blank ones', async () => {
  const res = new Response('a\nb\n\nc\n');
  const out = [];
  for await (const line of readLines(res)) out.push(line);
  assert.deepEqual(out, ['a', 'b', 'c']);
});

test('readLines reassembles a line split across chunks', async () => {
  // The case the buffer exists for: providers split frames mid-token.
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('{"par'));
      c.enqueue(new TextEncoder().encode('tial":1}\n{"next":2}\n'));
      c.close();
    },
  });
  const out = [];
  for await (const line of readLines(new Response(stream))) out.push(line);
  assert.deepEqual(out, ['{"partial":1}', '{"next":2}']);
});

test('readLines yields a trailing line with no newline', async () => {
  const out = [];
  for await (const line of readLines(new Response('only'))) out.push(line);
  assert.deepEqual(out, ['only']);
});
