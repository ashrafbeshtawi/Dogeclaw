// The admin gate inside the agent loop (src/agent.js): admin-only tools are
// offered to the model only for is_admin agents, a non-admin agent calling
// one by name is refused before the handler runs, and callDepth reaches the
// tool context. DB and LLM modules are replaced with in-memory fakes.
// Run with: npm test (node --test, stdlib only — no framework).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const admins = new Set([1]);
let script = [];
const offeredTools = [];
const systemPrompts = [];

mock.module('../src/llm.js', {
  namedExports: {
    chat: async (messages, tools) => {
      offeredTools.push(tools.map(t => t.function.name));
      systemPrompts.push(messages[0].content);
      return script.shift() || { content: 'done' };
    },
    chatStream: async () => ({ content: 'done' }),
  },
});
mock.module('../src/tools/skills.js', { namedExports: { listSkillsForAgent: async () => [] } });
mock.module('../src/db/mcpServers.js', { namedExports: { getAgentMcpServerNames: async () => [] } });
mock.module('../src/db/searchEngines.js', { namedExports: { hasActiveSearchEngine: async () => false } });
mock.module('../src/db/settings.js', { namedExports: { getTimezone: async () => 'UTC' } });
mock.module('../src/db/agentRuntime.js', { namedExports: { isAdminAgent: async id => admins.has(id) } });

const { Agent } = await import('../src/agent.js');
const { UNTRUSTED_DATA_RULE } = await import('../src/lib/adminTools.js');
const { ToolRegistry } = await import('../src/tools/index.js');

function setup() {
  const registry = new ToolRegistry();
  const seen = [];
  const def = name => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } });
  registry.register('shell_exec', def('shell_exec'), async () => ({ ok: true }));
  registry.register('list_agents', def('list_agents'), async (_a, ctx) => { seen.push(ctx); return { agents: [] }; }, { adminOnly: true });
  return { agent: new Agent(registry), seen };
}

const opts = agentId => ({ agentId, modelConfig: { model_id: 'm', provider: 'ollama' } });

test('admin agents are offered the admin tools', async () => {
  offeredTools.length = 0;
  script = [];
  const { agent } = setup();
  await agent.run('hi', [], opts(1));
  assert.ok(offeredTools[0].includes('list_agents'));
  assert.ok(offeredTools[0].includes('shell_exec'));
});

test('normal agents are not offered the admin tools', async () => {
  offeredTools.length = 0;
  script = [];
  const { agent } = setup();
  await agent.run('hi', [], opts(2));
  assert.equal(offeredTools[0].includes('list_agents'), false);
  assert.ok(offeredTools[0].includes('shell_exec'));
});

test('only admin agents get the untrusted-data rule in their system prompt', async () => {
  systemPrompts.length = 0;
  script = [];
  const { agent } = setup();
  await agent.run('hi', [], opts(1));
  await agent.run('hi', [], opts(2));
  assert.ok(systemPrompts[0].includes(UNTRUSTED_DATA_RULE));
  assert.equal(systemPrompts[1].includes(UNTRUSTED_DATA_RULE), false);
});

test('a normal agent calling an admin tool by name is refused', async () => {
  script = [{ content: '', tool_calls: [{ id: 'c1', function: { name: 'list_agents', arguments: {} } }] }];
  const { agent, seen } = setup();
  const res = await agent.run('hi', [], opts(2));
  assert.equal(seen.length, 0);
  assert.match(res.toolCalls[0].result.error, /Unknown tool/);
});

test('callDepth is passed to the tool context', async () => {
  script = [{ content: '', tool_calls: [{ id: 'c1', function: { name: 'list_agents', arguments: {} } }] }];
  const { agent, seen } = setup();
  await agent.run('hi', [], { ...opts(1), callDepth: 1 });
  assert.equal(seen[0].callDepth, 1);
  assert.equal(seen[0].agentId, 1);
});
