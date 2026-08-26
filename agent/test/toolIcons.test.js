// Unit tests for the tool-usage indicator helpers (src/lib/toolIcons.js):
// the 🗄️/🔧 line is derived from actual tool calls, model-imitated lines
// are stripped, and history replay traces list the tools a turn used.
// Run with: npm test (node --test, stdlib only — no framework).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolIcons, appendToolIcons, toolTrace } from '../src/lib/toolIcons.js';

test('toolIcons: database vs other tools vs both vs none', () => {
  assert.equal(toolIcons([]), '');
  assert.equal(toolIcons([{ name: 'database' }]), '🗄️');
  assert.equal(toolIcons([{ name: 'query_database' }]), '🗄️');
  assert.equal(toolIcons([{ name: 'db_select' }]), '🗄️');
  assert.equal(toolIcons([{ name: 'db_tables' }]), '🗄️');
  assert.equal(toolIcons([{ name: 'web_search' }]), '🔧');
  assert.equal(toolIcons([{ name: 'db_insert' }, { name: 'web_search' }]), '🗄️🔧');
});

test('appendToolIcons: no tools → content unchanged, no line', () => {
  assert.equal(appendToolIcons('hello', []), 'hello');
});

test('appendToolIcons: appends the icon line after a blank line', () => {
  assert.equal(appendToolIcons('done', [{ name: 'database' }]), 'done\n\n🗄️');
});

test('appendToolIcons: strips a model-written icon-only last line first', () => {
  assert.equal(appendToolIcons('done\n\n🗄️🔧', [{ name: 'web_search' }]), 'done\n\n🔧');
  assert.equal(appendToolIcons('done\n🔧', []), 'done');
});

test('appendToolIcons: strips an imitated [used tools: ...] trace line', () => {
  assert.equal(appendToolIcons('done\n[used tools: database]', []), 'done');
  assert.equal(appendToolIcons('done\n[used tools: database]\n🗄️', []), 'done');
});

test('appendToolIcons: icon lines inside the text are left alone', () => {
  assert.equal(appendToolIcons('a 🔧 wrench mid-sentence', []), 'a 🔧 wrench mid-sentence');
});

test('appendToolIcons: empty content with tools → just the icons', () => {
  assert.equal(appendToolIcons('', [{ name: 'web_search' }]), '🔧');
});

test('toolTrace: unique tool names in call order, empty for none', () => {
  assert.equal(toolTrace([]), '');
  assert.equal(
    toolTrace([{ name: 'web_search' }, { name: 'database' }, { name: 'web_search' }]),
    '[used tools: web_search, database]',
  );
});
