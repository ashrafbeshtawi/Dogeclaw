// OpenAI-compatible tool-call wire format (src/llm.js).
//
// The internal message shape is Ollama's: object-valued arguments, no ids.
// OpenAI requires id + type + string arguments on every tool call and a
// tool_call_id on every tool result. Sending the internal shape verbatim made
// strict upstream providers reject the request with "N validation errors",
// which surfaced as an intermittent `OpenRouter 400: Provider returned error`
// — intermittent only because lenient upstreams accepted it. Stubbed fetch,
// no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chat, chatStream } from '../src/llm.js';

const OPTS = { provider: 'openrouter', model: 'test-model', apiKey: 'k', baseUrl: 'https://or.example' };

function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

function okResponse() {
  return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
}

test('a tool round-trip serializes to the OpenAI wire shape', async () => {
  let sent;
  const restore = stubFetch(async (_url, init) => { sent = JSON.parse(init.body); return okResponse(); });
  try {
    await chat([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_abc', function: { name: 'sql', arguments: { q: 'SELECT 1' } } }] },
      { role: 'tool', content: '{"rows":[]}', tool_call_id: 'call_abc', _toolName: 'sql' },
    ], [], OPTS);
  } finally { restore(); }

  const call = sent.messages[1].tool_calls[0];
  assert.equal(call.id, 'call_abc');
  assert.equal(call.type, 'function');
  // arguments must be a JSON string on the wire, not the internal object
  assert.equal(typeof call.function.arguments, 'string');
  assert.deepEqual(JSON.parse(call.function.arguments), { q: 'SELECT 1' });

  // the result names the call it answers, and internal plumbing stays internal
  assert.equal(sent.messages[2].tool_call_id, 'call_abc');
  assert.equal('_toolName' in sent.messages[2], false);
});

test('a tool call with no id still serializes with one', async () => {
  let sent;
  const restore = stubFetch(async (_url, init) => { sent = JSON.parse(init.body); return okResponse(); });
  try {
    await chat([
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'f', arguments: {} } }] },
    ], [], OPTS);
  } finally { restore(); }
  assert.ok(sent.messages[0].tool_calls[0].id, 'id must never be absent on the wire');
});

test('plain messages carry no tool fields', async () => {
  let sent;
  const restore = stubFetch(async (_url, init) => { sent = JSON.parse(init.body); return okResponse(); });
  try {
    await chat([{ role: 'user', content: 'hi' }], [], OPTS);
  } finally { restore(); }
  assert.deepEqual(sent.messages[0], { role: 'user', content: 'hi' });
});

test('non-streaming: provider tool call ids survive parsing', async () => {
  const restore = stubFetch(async () => new Response(JSON.stringify({
    choices: [{ message: { content: '', tool_calls: [
      { id: 'call_xyz', type: 'function', function: { name: 'f', arguments: '{"a":1}' } },
    ] } }],
  }), { status: 200 }));
  try {
    const res = await chat([{ role: 'user', content: 'q' }], [], OPTS);
    assert.equal(res.tool_calls[0].id, 'call_xyz');
    // arguments stay an object internally — the tool registry executes on that
    assert.deepEqual(res.tool_calls[0].function.arguments, { a: 1 });
  } finally { restore(); }
});

test('streaming: the id arrives on the first delta and is kept whole', async () => {
  const sse = [
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_s1","function":{"name":"f","arguments":"{\\"a\\":"}}]}}]}',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}',
    'data: [DONE]',
  ].join('\n') + '\n';
  const restore = stubFetch(async () => new Response(sse, { status: 200 }));
  try {
    const res = await chatStream([{ role: 'user', content: 'q' }], [], OPTS, () => {});
    assert.equal(res.tool_calls.length, 1);
    assert.equal(res.tool_calls[0].id, 'call_s1');
    assert.equal(res.tool_calls[0].function.name, 'f');
    assert.deepEqual(res.tool_calls[0].function.arguments, { a: 1 });
  } finally { restore(); }
});

test('streaming: two parallel calls keep their own ids', async () => {
  const sse = [
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"one","arguments":"{}"}}]}}]}',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_b","function":{"name":"two","arguments":"{}"}}]}}]}',
    'data: [DONE]',
  ].join('\n') + '\n';
  const restore = stubFetch(async () => new Response(sse, { status: 200 }));
  try {
    const res = await chatStream([{ role: 'user', content: 'q' }], [], OPTS, () => {});
    assert.deepEqual(res.tool_calls.map(tc => [tc.id, tc.function.name]), [['call_a', 'one'], ['call_b', 'two']]);
  } finally { restore(); }
});
