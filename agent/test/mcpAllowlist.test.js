// Unit tests for the MCP tool allowlist semantics (src/lib/mcpAllowlist.js):
// null = expose everything, [] = expose nothing, otherwise the named subset.
// Run with: npm test (node --test, stdlib only — no framework).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterAllowedTools } from '../src/lib/mcpAllowlist.js';

const TOOLS = [{ name: 'list_events' }, { name: 'create_event' }, { name: 'delete_event' }];

test('filterAllowedTools: null exposes every tool', () => {
  assert.deepEqual(filterAllowedTools(TOOLS, null), TOOLS);
  assert.deepEqual(filterAllowedTools(TOOLS, undefined), TOOLS);
});

test('filterAllowedTools: empty allowlist exposes nothing', () => {
  assert.deepEqual(filterAllowedTools(TOOLS, []), []);
});

test('filterAllowedTools: subset exposes exactly the named tools', () => {
  assert.deepEqual(
    filterAllowedTools(TOOLS, ['list_events', 'nonexistent']),
    [{ name: 'list_events' }],
  );
});

test('filterAllowedTools: empty tool list stays empty', () => {
  assert.deepEqual(filterAllowedTools([], null), []);
  assert.deepEqual(filterAllowedTools(undefined, null), []);
});
