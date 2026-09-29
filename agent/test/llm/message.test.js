// src/llm/message.js — the internal shape's only runtime rule: `_`-prefixed
// side channels belong to one provider and must never reach a wire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripInternalFields } from '../../src/llm/message.js';

test('drops every documented side channel', () => {
  const out = stripInternalFields({
    role: 'assistant',
    content: 'hi',
    _toolName: 'db_run_sql',
    _geminiParts: [{ text: 'hi' }],
    _finishReason: 'STOP',
  });
  assert.deepEqual(out, { role: 'assistant', content: 'hi' });
});

test('drops any future underscore field without being told about it', () => {
  // The rule is the prefix, not a list — a provider adding a side channel
  // should not also have to remember to update a strip list.
  const out = stripInternalFields({ role: 'user', content: 'q', _somethingNew: 1 });
  assert.deepEqual(out, { role: 'user', content: 'q' });
});

test('keeps every field of the shared shape', () => {
  const msg = {
    role: 'assistant', content: 'x',
    tool_calls: [{ id: 'c1', function: { name: 'f', arguments: { a: 1 } } }],
    tool_call_id: 'c0', images: ['b64'], audio: 'a64', audioMime: 'audio/ogg',
    video: 'v64', videoMime: 'video/mp4',
  };
  assert.deepEqual(stripInternalFields(msg), msg);
});

test('does not mutate its input', () => {
  const msg = { role: 'user', content: 'q', _toolName: 'x' };
  stripInternalFields(msg);
  assert.equal(msg._toolName, 'x');
});

test('leaves nested values alone', () => {
  // Only top-level keys are provider plumbing; a tool argument legitimately
  // named with an underscore is data, not a side channel.
  const out = stripInternalFields({
    role: 'assistant',
    tool_calls: [{ id: 'c', function: { name: 'f', arguments: { _private: 1 } } }],
  });
  assert.deepEqual(out.tool_calls[0].function.arguments, { _private: 1 });
});
