// src/llm/openrouter.js — request-shaping and headers.
//
// The tool-call wire format and reasoning capture are pinned in
// test/openaiToolCalls.test.js and test/llmReasoning.test.js, which go
// through the router and are deliberately left untouched by the module
// split. This file covers what those two don't.
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
