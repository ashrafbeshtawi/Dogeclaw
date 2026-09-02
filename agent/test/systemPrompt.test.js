// The STYLE block enforces terse, chat-style replies. It must be appended
// outside the replaceable base so a custom per-agent system_prompt from the
// admin UI can never strip it — that was the original bug.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from '../src/agent.js';

const agent = new Agent({ getDefinitions: () => [] });

test('default prompt contains the STYLE rules and example', async () => {
  const prompt = await agent.buildSystemPrompt(null, null);
  assert.match(prompt, /STYLE — these rules always apply/);
  assert.match(prompt, /1-3 short sentences/);
  assert.match(prompt, /Example of the expected tone/);
});

test('custom agent prompt keeps the STYLE rules', async () => {
  const prompt = await agent.buildSystemPrompt('You are Bob, a pirate.', null);
  assert.ok(prompt.startsWith('You are Bob, a pirate.'));
  assert.match(prompt, /STYLE — these rules always apply/);
  assert.match(prompt, /1-3 short sentences/);
});
