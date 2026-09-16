// src/llm/google.js — Gemini shares nothing with the internal shape: roles
// are renamed, tool results are keyed by function NAME rather than call id,
// and an assistant turn may have to be replayed as raw parts so its
// thoughtSignature survives. All of that was previously untested.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chat, chatStream } from '../../src/llm/google.js';
import { capture, sse, json, conversation } from './helpers.js';

const OPTS = { model: 'gemini-x', apiKey: 'K', baseUrl: 'https://g.test' };
const EMPTY = () => json({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });

function quiet(fn) {
  // logGeminiEmpty warns on empty turns; several tests provoke that deliberately.
  const original = console.warn;
  console.warn = () => {};
  return Promise.resolve(fn()).finally(() => { console.warn = original; });
}

test('system turns become systemInstruction, not a message', async () => {
  const { seen, restore } = capture(EMPTY);
  try { await chat(conversation(), [], OPTS); } finally { restore(); }

  assert.deepEqual(seen.body.systemInstruction, { parts: [{ text: 'be brief' }] });
  assert.equal(seen.body.contents.some(c => c.role === 'system'), false);
});

test('a tool result becomes a functionResponse keyed by name', async () => {
  // Gemini has no tool_call_id; _toolName is the side channel that exists
  // precisely to carry the name this needs.
  const { seen, restore } = capture(EMPTY);
  try { await chat(conversation(), [], OPTS); } finally { restore(); }

  const fn = seen.body.contents.find(c => c.role === 'function');
  assert.deepEqual(fn.parts[0].functionResponse, {
    name: 'db_run_sql',
    response: { rows: [1] },
  });
});

test('a tool result that is not JSON is passed through as text', async () => {
  const { seen, restore } = capture(EMPTY);
  try {
    await chat([{ role: 'tool', content: 'plain text', _toolName: 'f' }], [], OPTS);
  } finally { restore(); }
  assert.equal(seen.body.contents[0].parts[0].functionResponse.response, 'plain text');
});

test('assistant turns map to role "model" and tool calls to functionCall', async () => {
  const { seen, restore } = capture(EMPTY);
  try { await chat(conversation(), [], OPTS); } finally { restore(); }

  const model = seen.body.contents.find(c => c.role === 'model');
  assert.deepEqual(model.parts[0].functionCall, {
    name: 'db_run_sql',
    args: { sql: 'SELECT 1' },
  });
});

test('raw gemini parts are replayed verbatim so thoughtSignature survives', async () => {
  const parts = [{ thoughtSignature: 'sig' }, { text: 'thought through' }];
  const { seen, restore } = capture(EMPTY);
  try {
    await chat([{ role: 'assistant', content: 'ignored', _geminiParts: parts }], [], OPTS);
  } finally { restore(); }

  assert.deepEqual(seen.body.contents[0], { role: 'model', parts });
});

test('media rides along as inline_data with its mime type', async () => {
  const { seen, restore } = capture(EMPTY);
  try {
    await chat([{ role: 'user', content: 'look', images: ['IMG'], audio: 'AUD', audioMime: 'audio/mp3' }], [], OPTS);
  } finally { restore(); }

  const kinds = seen.body.contents[0].parts.map(p => p.inline_data?.mime_type).filter(Boolean);
  assert.deepEqual(kinds, ['audio/mp3', 'image/png']);
});

test('a message with nothing in it still gets a part', async () => {
  // Gemini rejects an empty parts array.
  const { seen, restore } = capture(EMPTY);
  try { await chat([{ role: 'user', content: '' }], [], OPTS); } finally { restore(); }
  assert.deepEqual(seen.body.contents[0].parts, [{ text: '' }]);
});

test('tools are declared in Gemini shape only when present', async () => {
  const none = capture(EMPTY);
  try { await chat([], [], OPTS); } finally { none.restore(); }
  assert.equal('tools' in none.seen.body, false);

  const some = capture(EMPTY);
  try {
    await chat([], [{ function: { name: 'f', description: 'd', parameters: { type: 'object' } } }], OPTS);
  } finally { some.restore(); }
  assert.deepEqual(some.seen.body.tools, [{
    functionDeclarations: [{ name: 'f', description: 'd', parameters: { type: 'object' } }],
  }]);
});

test('the response parses back into the internal shape', async () => {
  const { restore } = capture(() => json({
    candidates: [{
      content: { parts: [{ text: 'part one ' }, { text: 'part two' }, { functionCall: { name: 'f', args: { a: 1 } } }] },
      finishReason: 'STOP',
    }],
  }));
  let res;
  try { res = await chat([], [], OPTS); } finally { restore(); }

  assert.equal(res.content, 'part one part two');
  assert.deepEqual(res.tool_calls, [{ function: { name: 'f', arguments: { a: 1 } } }]);
  assert.equal(res._finishReason, 'STOP');
  assert.equal(res._geminiParts.length, 3);
});

test('a functionCall with no args still parses', async () => {
  const { restore } = capture(() => json({
    candidates: [{ content: { parts: [{ functionCall: { name: 'f' } }] } }],
  }));
  let res;
  try { res = await chat([], [], OPTS); } finally { restore(); }
  assert.deepEqual(res.tool_calls[0].function.arguments, {});
});

test('an empty turn is reported with its finishReason and part kinds', async () => {
  // The diagnostic that stopped "(no response)" being a mystery.
  const warns = [];
  const original = console.warn;
  console.warn = m => warns.push(m);
  const { restore } = capture(() => json({
    candidates: [{ content: { parts: [{ thoughtSignature: 'sig' }] }, finishReason: 'MAX_TOKENS' }],
  }));
  try { await chat([], [], OPTS); } finally { restore(); console.warn = original; }

  assert.equal(warns.length, 1);
  assert.match(warns[0], /finishReason=MAX_TOKENS/);
  assert.match(warns[0], /parts=\[thought\]/);
});

test('streaming concatenates text and collects function calls', async () => {
  const events = [];
  const { restore } = capture(() => sse([
    'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'one ' }] } }] }),
    'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'two' }] } }] }),
    'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: 'f', args: {} } }] }, finishReason: 'STOP' }] }),
  ]));
  let res;
  try { res = await chatStream([], [], OPTS, (t, d) => events.push([t, d])); } finally { restore(); }

  assert.equal(res.content, 'one two');
  assert.equal(res.tool_calls[0].function.name, 'f');
  assert.equal(res._finishReason, 'STOP');
  assert.deepEqual(events, [['content', 'one '], ['content', 'two']]);
});

test('streaming preserves every raw part across frames', async () => {
  const { restore } = capture(() => sse([
    'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ thoughtSignature: 's' }] } }] }),
    'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }),
  ]));
  let res;
  try { res = await chatStream([], [], OPTS, () => {}); } finally { restore(); }
  assert.equal(res._geminiParts.length, 2);
});

test('URLs put alt=sse ahead of the key, and only when streaming', async () => {
  const urls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async u => {
    urls.push(u);
    return u.includes('streamGenerateContent')
      ? sse(['data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'x' }] } }] })])
      : json({ candidates: [{ content: { parts: [{ text: 'x' }] } }] });
  };
  try {
    await chatStream([], [], OPTS, () => {});
    await chat([], [], OPTS);
  } finally { globalThis.fetch = original; }

  assert.equal(urls[0], 'https://g.test/v1beta/models/gemini-x:streamGenerateContent?alt=sse&key=K');
  assert.equal(urls[1], 'https://g.test/v1beta/models/gemini-x:generateContent?key=K');
});

test('an error response carries the provider name', async () => {
  const { restore } = capture(() => new Response('bad key', { status: 403 }));
  try {
    await quiet(() => assert.rejects(() => chat([], [], OPTS), /Google 403: bad key/));
  } finally { restore(); }
});
