// src/llm/ollama.js — Ollama's wire format is closest to the internal shape,
// which is exactly why its conversion needs pinning: it is the one most
// likely to be "fixed" back into a pass-through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chat, chatStream } from '../../src/llm/ollama.js';
import { capture, sse, json, conversation, findInternalFields } from './helpers.js';

const OPTS = { model: 'gemma3:1b', baseUrl: 'http://ollama.test' };

test('posts to /api/chat with the model and stream flag', async () => {
  const { seen, restore } = capture(() => json({ message: { role: 'assistant', content: 'hi' } }));
  try {
    const res = await chat([{ role: 'user', content: 'q' }], [], OPTS);
    assert.equal(res.content, 'hi');
  } finally { restore(); }

  assert.equal(seen.url, 'http://ollama.test/api/chat');
  assert.equal(seen.body.model, 'gemma3:1b');
  assert.equal(seen.body.stream, false);
});

test('think defaults to false and is forwarded when set', async () => {
  let body;
  const off = capture(() => json({ message: {} }));
  try { await chat([], [], OPTS); body = off.seen.body; } finally { off.restore(); }
  assert.equal(body.think, false);

  const on = capture(() => json({ message: {} }));
  try { await chat([], [], { ...OPTS, think: true }); body = on.seen.body; } finally { on.restore(); }
  assert.equal(body.think, true);
});

test('tools are sent only when there are any', async () => {
  const none = capture(() => json({ message: {} }));
  try { await chat([], [], OPTS); } finally { none.restore(); }
  assert.equal('tools' in none.seen.body, false);

  const some = capture(() => json({ message: {} }));
  const tools = [{ type: 'function', function: { name: 'f', description: 'd', parameters: {} } }];
  try { await chat([], tools, OPTS); } finally { some.restore(); }
  assert.deepEqual(some.seen.body.tools, tools);
});

test('side channels never reach the wire', async () => {
  // Ollama used to receive `messages` raw, so _toolName and friends went out
  // with every request. It ignored them; that was luck, not design.
  const { seen, restore } = capture(() => json({ message: {} }));
  try { await chat(conversation(), [], OPTS); } finally { restore(); }

  assert.deepEqual(findInternalFields(seen.body), []);
  // fields of the shared shape still go through
  assert.equal(seen.body.messages[3].tool_call_id, 'call_1');
});

test('streaming accumulates content, thinking and tool calls', async () => {
  const events = [];
  const { restore } = capture(() => sse([
    JSON.stringify({ message: { thinking: 'let me ' } }),
    JSON.stringify({ message: { thinking: 'check' } }),
    JSON.stringify({ message: { content: 'the ' } }),
    JSON.stringify({ message: { content: 'answer' } }),
    JSON.stringify({ message: { tool_calls: [{ function: { name: 'f', arguments: { a: 1 } } }] } }),
  ]));
  let res;
  try {
    res = await chatStream([{ role: 'user', content: 'q' }], [], OPTS, (t, d) => events.push([t, d]));
  } finally { restore(); }

  assert.equal(res.content, 'the answer');
  assert.equal(res.thinking, 'let me check');
  assert.equal(res.tool_calls[0].function.name, 'f');
  assert.deepEqual(events, [
    ['thinking', 'let me '], ['thinking', 'check'],
    ['content', 'the '], ['content', 'answer'],
  ]);
});

test('streaming survives a malformed frame mid-response', async () => {
  const original = console.warn;
  console.warn = () => {};
  const { restore } = capture(() => sse([
    JSON.stringify({ message: { content: 'before' } }),
    '{ this is not json',
    JSON.stringify({ message: { content: '/after' } }),
  ]));
  let res;
  try { res = await chatStream([], [], OPTS, () => {}); }
  finally { restore(); console.warn = original; }

  assert.equal(res.content, 'before/after');
});

test('an error response carries the provider name', async () => {
  const { restore } = capture(() => new Response('model not found', { status: 404 }));
  try {
    await assert.rejects(() => chat([], [], OPTS), /Ollama 404: model not found/);
  } finally { restore(); }
});
