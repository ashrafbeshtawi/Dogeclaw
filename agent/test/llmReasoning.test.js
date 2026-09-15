// OpenRouter reasoning capture (src/llm.js): the `reasoning` field on
// messages/deltas must surface as `thinking` — returned on the response and
// emitted as streaming events — so it persists and renders like Ollama's
// native thinking. Stubbed fetch, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chat, chatStream } from '../src/llm.js';

const OPTS = { provider: 'openrouter', model: 'test-model', apiKey: 'k', baseUrl: 'https://or.example' };

function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

test('non-streaming: message.reasoning returns as thinking', async () => {
  const restore = stubFetch(async () => new Response(JSON.stringify({
    choices: [{ message: { content: 'hi', reasoning: 'because reasons' } }],
  }), { status: 200 }));
  try {
    const res = await chat([{ role: 'user', content: 'q' }], [], OPTS);
    assert.equal(res.content, 'hi');
    assert.equal(res.thinking, 'because reasons');
  } finally { restore(); }
});

test('non-streaming: no reasoning → no thinking field', async () => {
  const restore = stubFetch(async () => new Response(JSON.stringify({
    choices: [{ message: { content: 'hi' } }],
  }), { status: 200 }));
  try {
    const res = await chat([{ role: 'user', content: 'q' }], [], OPTS);
    assert.equal(res.thinking, undefined);
  } finally { restore(); }
});

test('think flag asks OpenRouter to reason; off sends no reasoning param', async () => {
  const bodies = [];
  const restore = stubFetch(async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200 });
  });
  try {
    await chat([{ role: 'user', content: 'q' }], [], { ...OPTS, think: true });
    await chat([{ role: 'user', content: 'q' }], [], { ...OPTS, think: false });
    assert.deepEqual(bodies[0].reasoning, { enabled: true });
    assert.equal('reasoning' in bodies[1], false);
  } finally { restore(); }
});

test('streaming: delta.reasoning emits thinking events and accumulates', async () => {
  const sse = [
    'data: {"choices":[{"delta":{"reasoning":"thin"}}]}',
    'data: {"choices":[{"delta":{"reasoning":"king…"}}]}',
    'data: {"choices":[{"delta":{"content":"answer"}}]}',
    'data: [DONE]',
  ].join('\n') + '\n';
  const restore = stubFetch(async () => new Response(sse, { status: 200 }));
  const events = [];
  try {
    const res = await chatStream([{ role: 'user', content: 'q' }], [], OPTS, (type, data) => events.push([type, data]));
    assert.deepEqual(events, [['thinking', 'thin'], ['thinking', 'king…'], ['content', 'answer']]);
    assert.equal(res.thinking, 'thinking…');
    assert.equal(res.content, 'answer');
  } finally { restore(); }
});
