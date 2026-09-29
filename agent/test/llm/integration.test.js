// All three adapters together, through the public router.
//
// The per-module tests prove each provider talks its own wire format. This
// file proves the thing the split actually claims: whatever an adapter does
// in between, the SAME internal conversation goes in and the SAME internal
// shape comes back out. That is the contract agent.js depends on, and the
// one that was silently broken before — OpenRouter inherited Ollama's shape
// and nothing noticed, because no test ever compared the providers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chat, chatStream } from '../../src/llm.js';
import { stubFetch, sse, json, conversation, findInternalFields } from './helpers.js';

const OPTS = {
  ollama: { provider: 'ollama', model: 'gemma3:1b', baseUrl: 'http://ollama.test' },
  openrouter: { provider: 'openrouter', model: 'm', apiKey: 'K', baseUrl: 'https://or.test' },
  google: { provider: 'google', model: 'gemini-x', apiKey: 'K', baseUrl: 'https://g.test' },
};

// Each provider answering the same way, in its own dialect: the text "done"
// plus one call to `finish` with {ok:true}.
const REPLIES = {
  ollama: () => json({
    message: { role: 'assistant', content: 'done', tool_calls: [{ function: { name: 'finish', arguments: { ok: true } } }] },
  }),
  openrouter: () => json({
    choices: [{ message: { content: 'done', tool_calls: [{ id: 'x1', type: 'function', function: { name: 'finish', arguments: '{"ok":true}' } }] } }],
  }),
  google: () => json({
    candidates: [{ content: { parts: [{ text: 'done' }, { functionCall: { name: 'finish', args: { ok: true } } }] } }],
  }),
};

const PROVIDERS = Object.keys(OPTS);
const TOOLS = [{ type: 'function', function: { name: 'finish', description: 'end', parameters: { type: 'object' } } }];

for (const name of PROVIDERS) {
  test(`${name}: the same conversation goes out without internal fields`, async () => {
    let body;
    const restore = stubFetch(async (_u, init) => { body = JSON.parse(init.body); return REPLIES[name](); });
    try { await chat(conversation(), TOOLS, OPTS[name]); } finally { restore(); }

    assert.deepEqual(findInternalFields(body), [], `${name} leaked a side channel`);
    // every provider must carry the user's question somewhere in its payload
    assert.ok(JSON.stringify(body).includes('what is in the table?'), `${name} dropped the user turn`);
    // and the tool must be declared in whatever shape it uses
    assert.ok(JSON.stringify(body).includes('finish'), `${name} dropped the tool declaration`);
  });

  test(`${name}: the reply comes back in the internal shape`, async () => {
    const restore = stubFetch(async () => REPLIES[name]());
    let res;
    try { res = await chat(conversation(), TOOLS, OPTS[name]); } finally { restore(); }

    assert.equal(res.role, 'assistant');
    assert.equal(res.content, 'done');
    assert.equal(res.tool_calls.length, 1);
    assert.equal(res.tool_calls[0].function.name, 'finish');
    // arguments are an OBJECT internally regardless of what the wire used —
    // ToolRegistry.execute runs on this directly
    assert.deepEqual(res.tool_calls[0].function.arguments, { ok: true });
  });
}

test('every provider agrees on the parsed result', async () => {
  // Compare them to each other rather than to a hand-written expectation:
  // if one adapter drifts, this fails even if the per-module test for it was
  // updated to match the drift.
  const results = {};
  for (const name of PROVIDERS) {
    const restore = stubFetch(async () => REPLIES[name]());
    try { results[name] = await chat(conversation(), TOOLS, OPTS[name]); } finally { restore(); }
  }

  const normalise = r => ({
    role: r.role,
    content: r.content,
    toolCalls: r.tool_calls.map(tc => ({ name: tc.function.name, args: tc.function.arguments })),
  });

  const [first, ...rest] = PROVIDERS;
  for (const other of rest) {
    assert.deepEqual(normalise(results[other]), normalise(results[first]),
      `${other} parses the same answer differently from ${first}`);
  }
});

const STREAMS = {
  ollama: () => sse([
    JSON.stringify({ message: { content: 'strea' } }),
    JSON.stringify({ message: { content: 'med' } }),
  ]),
  openrouter: () => sse([
    'data: ' + JSON.stringify({ choices: [{ delta: { content: 'strea' } }] }),
    'data: ' + JSON.stringify({ choices: [{ delta: { content: 'med' } }] }),
    'data: [DONE]',
  ]),
  google: () => sse([
    'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'strea' }] } }] }),
    'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'med' }] } }] }),
  ]),
};

test('every provider streams content the same way to the caller', async () => {
  for (const name of PROVIDERS) {
    const events = [];
    const restore = stubFetch(async () => STREAMS[name]());
    let res;
    try { res = await chatStream([{ role: 'user', content: 'q' }], [], OPTS[name], (t, d) => events.push([t, d])); }
    finally { restore(); }

    assert.equal(res.content, 'streamed', `${name} accumulated wrong`);
    assert.deepEqual(events, [['content', 'strea'], ['content', 'med']], `${name} emitted wrong events`);
  }
});

test('every provider surfaces an HTTP failure as a named error', async () => {
  for (const name of PROVIDERS) {
    const restore = stubFetch(async () => new Response('upstream exploded', { status: 500 }));
    try {
      await assert.rejects(() => chat([], [], OPTS[name]), /500: upstream exploded/, `${name} swallowed the error`);
    } finally { restore(); }
  }
});
