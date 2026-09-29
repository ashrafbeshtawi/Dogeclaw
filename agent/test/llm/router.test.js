// UNIT: src/llm.js — the router, and nothing else.
//
// Its entire job is picking an adapter from a provider name. Anything that
// asserts what an adapter *does* belongs in that adapter's own unit file;
// anything asserting they agree belongs in integration.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chat, chatStream } from '../../src/llm.js';
import { stubFetch, sse, json } from './helpers.js';

// Each provider is identified by the URL only it would ever call.
const DISPATCH = [
  ['ollama', { model: 'm', baseUrl: 'http://ollama.test' }, /^http:\/\/ollama\.test\/api\/chat$/],
  ['openrouter', { model: 'm', apiKey: 'K', baseUrl: 'https://or.test' }, /^https:\/\/or\.test\/api\/v1\/chat\/completions$/],
  ['google', { model: 'g', apiKey: 'K', baseUrl: 'https://g.test' }, /^https:\/\/g\.test\/v1beta\/models\/g:generateContent/],
];

// Enough of a reply for every adapter to parse without throwing.
const ANY_REPLY = () => json({
  message: { role: 'assistant', content: '' },
  choices: [{ message: { content: '' } }],
  candidates: [{ content: { parts: [{ text: '' }] } }],
});

for (const [provider, opts, urlPattern] of DISPATCH) {
  test(`chat dispatches provider "${provider}" to its own adapter`, async () => {
    let url;
    const restore = stubFetch(async u => { url = u; return ANY_REPLY(); });
    try { await chat([], [], { provider, ...opts }); } finally { restore(); }
    assert.match(url, urlPattern);
  });
}

test('chatStream dispatches to the streaming entry point of the same adapter', async () => {
  let url;
  const restore = stubFetch(async u => { url = u; return sse(['data: [DONE]']); });
  try {
    await chatStream([], [], { provider: 'openrouter', model: 'm', apiKey: 'K', baseUrl: 'https://or.test' }, () => {});
  } finally { restore(); }
  assert.match(url, /\/api\/v1\/chat\/completions$/);
});

test('an unset provider is the documented default, Ollama', async () => {
  let url;
  const restore = stubFetch(async u => { url = u; return json({ message: { content: 'hi' } }); });
  try { await chat([], [], { model: 'm', baseUrl: 'http://ollama.test' }); } finally { restore(); }
  assert.match(url, /^http:\/\/ollama\.test\/api\/chat$/);
});

test('an unknown provider fails loudly instead of falling back to Ollama', async () => {
  // A typo in a model row used to look like a mysteriously wrong model.
  await assert.rejects(
    () => chat([], [], { provider: 'openai', model: 'm' }),
    /Unknown model provider "openai".*google, ollama, openrouter/s,
  );
});

test('the streaming entry point rejects an unknown provider too', async () => {
  await assert.rejects(
    () => chatStream([], [], { provider: 'typo', model: 'm' }, () => {}),
    /Unknown model provider "typo"/,
  );
});

test('the router never reaches the network for an unknown provider', async () => {
  // It must fail before dispatch, not inside some adapter.
  let called = false;
  const restore = stubFetch(async () => { called = true; return ANY_REPLY(); });
  try {
    await assert.rejects(() => chat([], [], { provider: 'nope', model: 'm' }));
  } finally { restore(); }
  assert.equal(called, false);
});
