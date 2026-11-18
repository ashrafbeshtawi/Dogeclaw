import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachResult, toolValueText, trimText, type ToolCall } from '../src/pages/index/toolCalls.ts';

test('trimText cuts past the limit and marks the cut', () => {
  assert.equal(trimText('abcdef', 3), 'abc…');
  assert.equal(trimText('abc', 3), 'abc');
});

test('toolValueText parses a JSON string so it can be pretty-printed', () => {
  assert.equal(toolValueText('{"a":1}', true), '{\n  "a": 1\n}');
  assert.equal(toolValueText({ a: 1 }, false), '{"a":1}');
});

test('toolValueText keeps plain text and blanks nullish values', () => {
  assert.equal(toolValueText('not json', true), 'not json');
  assert.equal(toolValueText('"quoted"', true), 'quoted');
  assert.equal(toolValueText(null, true), '');
});

test('attachResult fills the oldest pending call with that name', () => {
  const calls: ToolCall[] = [
    { name: 'web_search', args: 1, hasResult: false },
    { name: 'web_search', args: 2, hasResult: false },
  ];
  const once = attachResult(calls, 'web_search', 'first');
  const twice = attachResult(once, 'web_search', 'second');
  assert.deepEqual(twice.map((c) => c.result), ['first', 'second']);
  assert.equal(attachResult(twice, 'web_search', 'third'), twice);
});
