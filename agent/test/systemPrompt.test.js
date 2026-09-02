// The STYLE block enforces terse, chat-style replies. It must be appended
// outside the replaceable base so a custom per-agent system_prompt from the
// admin UI can never strip it — that was the original bug.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeSystemPrompt, DEFAULT_SYSTEM_PROMPT } from '../src/lib/systemPrompt.js';

const opts = { workspace: '/files', toolDescriptions: '- t(): a tool' };

test('default prompt contains the STYLE rules and example', () => {
  const prompt = composeSystemPrompt(opts);
  assert.ok(prompt.startsWith(DEFAULT_SYSTEM_PROMPT));
  assert.match(prompt, /STYLE — these rules always apply/);
  assert.match(prompt, /1-3 short sentences/);
  assert.match(prompt, /Example of the expected tone/);
});

test('custom agent prompt keeps the STYLE rules', () => {
  const prompt = composeSystemPrompt({ ...opts, customPrompt: 'You are Bob, a pirate.' });
  assert.ok(prompt.startsWith('You are Bob, a pirate.'));
  assert.match(prompt, /STYLE — these rules always apply/);
  assert.match(prompt, /1-3 short sentences/);
});
