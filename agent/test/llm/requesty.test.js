// UNIT: src/llm/requesty.js and src/llm/openaiCompatible.js — imported
// directly. Both share the OpenAI-dialect adapter with OpenRouter, whose
// wire-format cases live in openrouter.test.js; these cover only what differs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as requesty from '../../src/llm/requesty.js';
import * as generic from '../../src/llm/openaiCompatible.js';
import { capture, sse, json } from './helpers.js';

const OK = () => json({ choices: [{ message: { content: 'ok' } }] });

const ADAPTERS = [
  ['Requesty', requesty, { model: 'openai/gpt-4o-mini', apiKey: 'K', baseUrl: 'https://router.requesty.test/v1' }, 'https://router.requesty.test/v1/chat/completions'],
  ['OpenAI-compatible', generic, { model: 'm', apiKey: 'K', baseUrl: 'https://gw.test/v1/' }, 'https://gw.test/v1/chat/completions'],
];

for (const [name, adapter, OPTS, url] of ADAPTERS) {
  test(`${name}: posts to <base>/chat/completions with a bearer key and no OpenRouter referer`, async () => {
    const { seen, restore } = capture(OK);
    try { await adapter.chat([], [], OPTS); } finally { restore(); }
    assert.equal(seen.url, url);
    assert.equal(seen.headers.Authorization, 'Bearer K');
    assert.equal('HTTP-Referer' in seen.headers, false);
  });

  test(`${name}: thinking asks via reasoning_effort, not OpenRouter's reasoning object`, async () => {
    const off = capture(OK);
    try { await adapter.chat([], [], OPTS); } finally { off.restore(); }
    assert.equal('reasoning_effort' in off.seen.body, false);

    const on = capture(OK);
    try { await adapter.chat([], [], { ...OPTS, think: true }); } finally { on.restore(); }
    assert.equal(on.seen.body.reasoning_effort, 'medium');
    assert.equal('reasoning' in on.seen.body, false);
  });

  test(`${name}: errors carry the provider name`, async () => {
    const { restore } = capture(() => new Response('nope', { status: 401 }));
    try {
      await assert.rejects(() => adapter.chat([], [], OPTS), new RegExp(`${name} 401: nope`));
    } finally { restore(); }
  });

  test(`${name}: reasoning_content is captured as thinking`, async () => {
    const one = capture(() => json({ choices: [{ message: { content: 'a', reasoning_content: 'why' } }] }));
    let res;
    try { res = await adapter.chat([], [], OPTS); } finally { one.restore(); }
    assert.equal(res.thinking, 'why');

    const events = [];
    const two = capture(() => sse([
      'data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: 'hm' } }] }),
      'data: ' + JSON.stringify({ choices: [{ delta: { content: 'yes' } }] }),
      'data: [DONE]',
    ]));
    try { res = await adapter.chatStream([], [], OPTS, (t, d) => events.push([t, d])); } finally { two.restore(); }
    assert.deepEqual(events, [['thinking', 'hm'], ['content', 'yes']]);
    assert.equal(res.thinking, 'hm');
  });
}
