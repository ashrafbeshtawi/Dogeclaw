// Per-agent MCP visibility: built-in tools are always visible, MCP tools
// only to agents assigned to their server, and an unassigned server is
// visible to nobody.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterVisibleEntries, groupEntriesByServer } from '../src/lib/mcpVisibility.js';

const def = name => ({ type: 'function', function: { name, description: 'd', parameters: { type: 'object', properties: {} } } });
const entries = [
  { name: 'read_skill', definition: def('read_skill'), meta: null },
  { name: 'mcp_jira_search', definition: def('mcp_jira_search'), meta: { mcpServer: 'jira', serverDescription: 'issue tracker' } },
  { name: 'mcp_jira_create', definition: def('mcp_jira_create'), meta: { mcpServer: 'jira', serverDescription: 'issue tracker' } },
  { name: 'mcp_github_prs', definition: def('mcp_github_prs'), meta: { mcpServer: 'github', serverDescription: '' } },
];

test('built-in tools are always visible; MCP tools only for assigned servers', () => {
  const names = filterVisibleEntries(entries, ['jira']).map(e => e.name);
  assert.deepEqual(names, ['read_skill', 'mcp_jira_search', 'mcp_jira_create']);
});

test('no assigned servers hides every MCP tool', () => {
  assert.deepEqual(filterVisibleEntries(entries, []).map(e => e.name), ['read_skill']);
  assert.deepEqual(filterVisibleEntries(entries, null).map(e => e.name), ['read_skill']);
});

test('groupEntriesByServer groups tools by server with its description', () => {
  const groups = groupEntriesByServer(entries);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].name, 'jira');
  assert.equal(groups[0].description, 'issue tracker');
  assert.deepEqual(groups[0].entries.map(e => e.name), ['mcp_jira_search', 'mcp_jira_create']);
  assert.equal(groups[1].name, 'github');
});

test('groupEntriesByServer ignores built-in tools', () => {
  assert.deepEqual(groupEntriesByServer([entries[0]]), []);
});
