// Unit tests for the ToolRegistry (src/tools/index.js) — the dispatch layer
// every model tool call goes through.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry } from '../src/tools/index.js';

const DEF = { type: 'function', function: { name: 'echo', description: 'echoes' } };

function makeRegistry() {
  const reg = new ToolRegistry();
  reg.register('echo', DEF, async (args, ctx) => ({ args, ctx }));
  return reg;
}

test('register / has / list / getDefinitions', () => {
  const reg = makeRegistry();
  assert.equal(reg.has('echo'), true);
  assert.equal(reg.has('nope'), false);
  assert.deepEqual(reg.list(), ['echo']);
  assert.deepEqual(reg.getDefinitions(), [DEF]);
});

test('getEntries exposes meta (null when not given)', () => {
  const reg = makeRegistry();
  reg.register('mcp_x_y', DEF, async () => ({}), { mcpServer: 'x', serverDescription: 'd' });
  const entries = reg.getEntries();
  assert.deepEqual(entries.map(e => e.name), ['echo', 'mcp_x_y']);
  assert.equal(entries[0].meta, null);
  assert.deepEqual(entries[1].meta, { mcpServer: 'x', serverDescription: 'd' });
});

test('execute passes object args and context through', async () => {
  const reg = makeRegistry();
  const res = await reg.execute('echo', { a: 1 }, { agentId: 7 });
  assert.deepEqual(res, { args: { a: 1 }, ctx: { agentId: 7 } });
});

test('execute JSON-parses string args (LLM wire format)', async () => {
  const reg = makeRegistry();
  const res = await reg.execute('echo', '{"a":1}');
  assert.deepEqual(res.args, { a: 1 });
});

test('unknown tool returns an error object instead of throwing', async () => {
  const reg = makeRegistry();
  assert.deepEqual(await reg.execute('nope', {}), { error: 'Unknown tool: nope' });
});

test('handler throw is caught and surfaced as { error }', async () => {
  const reg = new ToolRegistry();
  reg.register('bomb', DEF, () => { throw new Error('kaboom'); });
  assert.deepEqual(await reg.execute('bomb', {}), { error: 'kaboom' });
});

test('malformed JSON string args surface as { error }, not a crash', async () => {
  const reg = makeRegistry();
  const res = await reg.execute('echo', '{not json');
  assert.ok(res.error);
});

// The README "Built-in tools" section lists these exact names, and skills /
// system prompts refer to them. A rename fails here — update the README too.
test('built-in tool names match the README list', async () => {
  const modules = ['exec', 'http', 'files', 'cron', 'db', 'web', 'history', 'skills'];
  const reg = new ToolRegistry();
  for (const m of modules) {
    const { register } = await import(`../src/tools/${m}.js`);
    register(reg);
  }
  assert.deepEqual(reg.list().sort(), [
    'add_cron', 'create_skill', 'db_describe_table', 'db_list_tables', 'db_run_sql',
    'delete_skill', 'file_operation', 'get_cron', 'http_request', 'list_crons',
    'read_skill', 'remove_cron', 'run_command', 'search_history', 'update_skill',
    'web_fetch', 'web_search',
  ]);
  for (const { name, definition } of reg.getEntries()) {
    assert.equal(definition.function.name, name, `definition name of ${name}`);
  }
});
