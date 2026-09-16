// The router's own contract: which adapter a provider name resolves to, and
// what happens when it resolves to none. Stubbed fetch, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chat, chatStream } from '../src/llm.js';
import { stripInternalFields } from '../src/llm/message.js';

function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

test('an unknown provider fails loudly instead of falling back to Ollama', async () => {
  await assert.rejects(
    () => chat([], [], { provider: 'openai', model: 'm' }),
    /Unknown model provider "openai".*google, ollama, openrouter/s,
  );
  await assert.rejects(
    () => chatStream([], [], { provider: 'typo', model: 'm' }, () => {}),
    /Unknown model provider "typo"/,
  );
});

test('an unset provider still routes to Ollama', async () => {
  let url;
  const restore = stubFetch(async u => {
    url = u;
    return new Response(JSON.stringify({ message: { role: 'assistant', content: 'hi' } }), { status: 200 });
  });
  try {
    const res = await chat([{ role: 'user', content: 'q' }], [], { model: 'm', baseUrl: 'http://ollama.test' });
    assert.equal(res.content, 'hi');
    assert.match(url, /^http:\/\/ollama\.test\/api\/chat$/);
  } finally { restore(); }
});

test('provider side channels never reach the Ollama wire', async () => {
  let sent;
  const restore = stubFetch(async (_u, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ message: { role: 'assistant', content: '' } }), { status: 200 });
  });
  try {
    await chat([
      { role: 'tool', content: '{}', tool_call_id: 'call_1', _toolName: 'sql' },
      { role: 'assistant', content: 'x', _geminiParts: [{ text: 'x' }], _finishReason: 'STOP' },
    ], [], { provider: 'ollama', model: 'm', baseUrl: 'http://ollama.test' });
  } finally { restore(); }

  assert.equal('_toolName' in sent.messages[0], false);
  assert.equal('_geminiParts' in sent.messages[1], false);
  assert.equal('_finishReason' in sent.messages[1], false);
  // fields that are part of the shared shape survive
  assert.equal(sent.messages[0].tool_call_id, 'call_1');
});

test('a provider error carries enough body to diagnose it', async () => {
  // 600 chars of validation detail: the old 200-char cap cut this kind of
  // body off mid-field and lost the actual cause.
  const body = JSON.stringify({ error: { message: 'x'.repeat(600) } });
  const restore = stubFetch(async () => new Response(body, { status: 400 }));
  try {
    await assert.rejects(
      () => chat([], [], { provider: 'openrouter', model: 'm', baseUrl: 'https://or.test', apiKey: 'k' }),
      err => {
        assert.match(err.message, /^OpenRouter 400: /);
        assert.ok(err.message.length > 500, `error was truncated to ${err.message.length} chars`);
        return true;
      },
    );
  } finally { restore(); }
});

test('google URLs keep alt=sse ahead of the key, and only when streaming', async () => {
  const urls = [];
  const restore = stubFetch(async u => {
    urls.push(u);
    // the streaming endpoint speaks SSE, the other returns a JSON document
    return u.includes('streamGenerateContent')
      ? new Response('data: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}\n', { status: 200 })
      : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }), { status: 200 });
  });
  const OPTS = { provider: 'google', model: 'gemini-x', apiKey: 'K', baseUrl: 'https://g.test' };
  try {
    await chatStream([{ role: 'user', content: 'q' }], [], OPTS, () => {});
    await chat([{ role: 'user', content: 'q' }], [], OPTS);
  } finally { restore(); }

  assert.equal(urls[0], 'https://g.test/v1beta/models/gemini-x:streamGenerateContent?alt=sse&key=K');
  assert.equal(urls[1], 'https://g.test/v1beta/models/gemini-x:generateContent?key=K');
});

test('stripInternalFields leaves a clean message untouched', () => {
  const msg = { role: 'user', content: 'hi', images: ['b64'] };
  assert.deepEqual(stripInternalFields(msg), msg);
});
