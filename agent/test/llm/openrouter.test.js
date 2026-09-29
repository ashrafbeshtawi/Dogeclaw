// UNIT: src/llm/openrouter.js — imported directly, never through the router.
//
// Covers request shaping, the tool-call wire format, and reasoning capture.
// The wire-format and reasoning cases previously lived in
// test/openaiToolCalls.test.js and test/llmReasoning.test.js, which reached
// this module through src/llm.js and so tested two modules at once; they are
// folded in here as unit tests against the module itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chat, chatStream } from '../../src/llm/openrouter.js';
import { capture, sse, json, conversation, findInternalFields } from './helpers.js';

const OPTS = { model: 'm', apiKey: 'K', baseUrl: 'https://or.test' };
const OK = () => json({ choices: [{ message: { content: 'ok' } }] });

test('authorises with the key and identifies the app', async () => {
  const { seen, restore } = capture(OK);
  try { await chat([], [], OPTS); } finally { restore(); }

  assert.equal(seen.headers.Authorization, 'Bearer K');
  assert.equal(seen.headers['HTTP-Referer'], 'https://dogeclaw.beshtawi.online');
  assert.equal(seen.url, 'https://or.test/api/v1/chat/completions');
});

test('reasoning is requested only when the model has thinking enabled', async () => {
  const off = capture(OK);
  try { await chat([], [], OPTS); } finally { off.restore(); }
  assert.equal('reasoning' in off.seen.body, false);

  const on = capture(OK);
  try { await chat([], [], { ...OPTS, think: true }); } finally { on.restore(); }
  assert.deepEqual(on.seen.body.reasoning, { enabled: true });
});

test('tools are mapped to the function wrapper only when present', async () => {
  const none = capture(OK);
  try { await chat([], [], OPTS); } finally { none.restore(); }
  assert.equal('tools' in none.seen.body, false);

  const some = capture(OK);
  try {
    await chat([], [{ function: { name: 'f', description: 'd', parameters: {} } }], OPTS);
  } finally { some.restore(); }
  assert.deepEqual(some.seen.body.tools, [{
    type: 'function',
    function: { name: 'f', description: 'd', parameters: {} },
  }]);
});

test('side channels never reach the wire', async () => {
  const { seen, restore } = capture(OK);
  try { await chat(conversation(), [], OPTS); } finally { restore(); }
  assert.deepEqual(findInternalFields(seen.body), []);
});

test('stream flag matches the entry point', async () => {
  const one = capture(OK);
  try { await chat([], [], OPTS); } finally { one.restore(); }
  assert.equal(one.seen.body.stream, false);

  const two = capture(() => sse(['data: [DONE]']));
  try { await chatStream([], [], OPTS, () => {}); } finally { two.restore(); }
  assert.equal(two.seen.body.stream, true);
});

test('streaming ignores frames that are not data lines', async () => {
  const { restore } = capture(() => sse([
    ': keep-alive comment',
    'event: ping',
    'data: ' + JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }),
    'data: [DONE]',
  ]));
  let res;
  try { res = await chatStream([], [], OPTS, () => {}); } finally { restore(); }
  assert.equal(res.content, 'hi');
});

test('a frame with no delta is skipped rather than crashing', async () => {
  const { restore } = capture(() => sse([
    'data: ' + JSON.stringify({ choices: [{ finish_reason: 'stop' }] }),
    'data: ' + JSON.stringify({ choices: [{ delta: { content: 'x' } }] }),
  ]));
  let res;
  try { res = await chatStream([], [], OPTS, () => {}); } finally { restore(); }
  assert.equal(res.content, 'x');
});

test('a response with no tool calls reports none rather than an empty array', async () => {
  const { restore } = capture(OK);
  let res;
  try { res = await chat([], [], OPTS); } finally { restore(); }
  assert.equal(res.tool_calls, undefined);
});

test('an error response carries the provider name', async () => {
  const { restore } = capture(() => new Response('rate limited', { status: 429 }));
  try {
    await assert.rejects(() => chat([], [], OPTS), /OpenRouter 429: rate limited/);
  } finally { restore(); }
});

// --- tool-call wire format ------------------------------------------------
// OpenAI requires an id and an explicit type on every tool call, arguments as
// a JSON string, and a tool_call_id on every result. Sending the internal
// shape verbatim made strict upstream providers reject the whole request.

test('a tool round-trip serializes to the OpenAI wire shape', async () => {
  const { seen, restore } = capture(OK);
  try {
    await chat([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_abc', function: { name: 'sql', arguments: { q: 'SELECT 1' } } }] },
      { role: 'tool', content: '{"rows":[]}', tool_call_id: 'call_abc', _toolName: 'sql' },
    ], [], OPTS);
  } finally { restore(); }

  const call = seen.body.messages[1].tool_calls[0];
  assert.equal(call.id, 'call_abc');
  assert.equal(call.type, 'function');
  assert.equal(typeof call.function.arguments, 'string');
  assert.deepEqual(JSON.parse(call.function.arguments), { q: 'SELECT 1' });
  assert.equal(seen.body.messages[2].tool_call_id, 'call_abc');
  assert.equal('_toolName' in seen.body.messages[2], false);
});

test('a tool call with no id still serializes with one', async () => {
  const { seen, restore } = capture(OK);
  try {
    await chat([{ role: 'assistant', content: '', tool_calls: [{ function: { name: 'f', arguments: {} } }] }], [], OPTS);
  } finally { restore(); }
  assert.ok(seen.body.messages[0].tool_calls[0].id, 'id must never be absent on the wire');
});

test('plain messages carry no tool fields', async () => {
  const { seen, restore } = capture(OK);
  try { await chat([{ role: 'user', content: 'hi' }], [], OPTS); } finally { restore(); }
  assert.deepEqual(seen.body.messages[0], { role: 'user', content: 'hi' });
});

test('non-streaming: provider tool call ids survive parsing', async () => {
  const { restore } = capture(() => json({
    choices: [{ message: { content: '', tool_calls: [
      { id: 'call_xyz', type: 'function', function: { name: 'f', arguments: '{"a":1}' } },
    ] } }],
  }));
  let res;
  try { res = await chat([], [], OPTS); } finally { restore(); }
  assert.equal(res.tool_calls[0].id, 'call_xyz');
  // arguments go back to an object — the tool registry executes on that
  assert.deepEqual(res.tool_calls[0].function.arguments, { a: 1 });
});

test('streaming: the id arrives on the first delta and is kept whole', async () => {
  const { restore } = capture(() => sse([
    'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_s1', function: { name: 'f', arguments: '{"a":' } }] } }] }),
    'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] } }] }),
    'data: [DONE]',
  ]));
  let res;
  try { res = await chatStream([], [], OPTS, () => {}); } finally { restore(); }
  assert.equal(res.tool_calls.length, 1);
  assert.equal(res.tool_calls[0].id, 'call_s1');
  assert.deepEqual(res.tool_calls[0].function.arguments, { a: 1 });
});

test('streaming: two parallel calls keep their own ids', async () => {
  const { restore } = capture(() => sse([
    'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'one', arguments: '{}' } }] } }] }),
    'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 1, id: 'call_b', function: { name: 'two', arguments: '{}' } }] } }] }),
    'data: [DONE]',
  ]));
  let res;
  try { res = await chatStream([], [], OPTS, () => {}); } finally { restore(); }
  assert.deepEqual(res.tool_calls.map(tc => [tc.id, tc.function.name]), [['call_a', 'one'], ['call_b', 'two']]);
});

// --- reasoning capture ----------------------------------------------------

test('non-streaming: message.reasoning surfaces as thinking', async () => {
  const { restore } = capture(() => json({ choices: [{ message: { content: 'hi', reasoning: 'because reasons' } }] }));
  let res;
  try { res = await chat([], [], OPTS); } finally { restore(); }
  assert.equal(res.content, 'hi');
  assert.equal(res.thinking, 'because reasons');
});

test('non-streaming: no reasoning means no thinking field', async () => {
  const { restore } = capture(OK);
  let res;
  try { res = await chat([], [], OPTS); } finally { restore(); }
  assert.equal(res.thinking, undefined);
});

test('streaming: delta.reasoning emits thinking events and accumulates', async () => {
  const events = [];
  const { restore } = capture(() => sse([
    'data: ' + JSON.stringify({ choices: [{ delta: { reasoning: 'thin' } }] }),
    'data: ' + JSON.stringify({ choices: [{ delta: { reasoning: 'king…' } }] }),
    'data: ' + JSON.stringify({ choices: [{ delta: { content: 'answer' } }] }),
    'data: [DONE]',
  ]));
  let res;
  try { res = await chatStream([], [], OPTS, (t, d) => events.push([t, d])); } finally { restore(); }
  assert.deepEqual(events, [['thinking', 'thin'], ['thinking', 'king…'], ['content', 'answer']]);
  assert.equal(res.thinking, 'thinking…');
  assert.equal(res.content, 'answer');
});
