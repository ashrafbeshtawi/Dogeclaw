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

test('MCP tools render grouped under their server with its description', () => {
  const def = (name, desc) => ({ type: 'function', function: { name, description: desc, parameters: { type: 'object', properties: { q: {} } } } });
  const prompt = composeSystemPrompt({
    ...opts,
    mcpGroups: [
      { name: 'jira', description: 'company issue tracker', entries: [{ definition: def('mcp_jira_search', 'search issues') }] },
      { name: 'github', description: '', entries: [{ definition: def('mcp_github_prs', 'list PRs') }] },
    ],
  });
  assert.match(prompt, /MCP server "jira" — company issue tracker\. Its tools \(prefixed mcp_jira_\) belong together:\n- mcp_jira_search\(q\): search issues/);
  // No description → header without the dash segment
  assert.match(prompt, /MCP server "github"\. Its tools \(prefixed mcp_github_\) belong together:\n- mcp_github_prs\(q\): list PRs/);
});

test('no MCP groups renders no MCP block', () => {
  const prompt = composeSystemPrompt(opts);
  assert.doesNotMatch(prompt, /MCP server/);
});

test('custom agent prompt keeps the STYLE rules', () => {
  const prompt = composeSystemPrompt({ ...opts, customPrompt: 'You are Bob, a pirate.' });
  assert.ok(prompt.startsWith('You are Bob, a pirate.'));
  assert.match(prompt, /STYLE — these rules always apply/);
  assert.match(prompt, /1-3 short sentences/);
});
