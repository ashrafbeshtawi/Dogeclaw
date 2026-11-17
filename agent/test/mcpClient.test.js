// McpManager connection lifecycle: failed connects close what they started,
// a closed connection drops the server's tools and reconnects with backoff.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

let servers = [];
mock.module('../src/db/mcpServers.js', { namedExports: { listEnabledServers: async () => servers } });

const { McpManager } = await import('../src/mcp/client.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

class FakeRegistry {
  tools = new Map();
  register(name, definition, handler) { this.tools.set(name, handler); }
  unregister(name) { this.tools.delete(name); }
  list() { return [...this.tools.keys()]; }
}

class FakeClient {
  closed = false;
  onclose;
  constructor({ connect = async () => {}, listTools = async () => ({ tools: [{ name: 'search' }] }), callTool } = {}) {
    this.connect = connect;
    this.listTools = listTools;
    if (callTool) this.callTool = callTool;
  }
  async close() { this.closed = true; }
  // What the SDK does when the transport goes away on its own.
  crash() { this.onclose?.(); }
}

// Hands out the given clients in order, one per connect attempt.
function setup(clients, opts = {}) {
  servers = [{ name: 'jira', transport: 'stdio', command: 'fake' }];
  const transports = [];
  const queue = [...clients];
  const registry = new FakeRegistry();
  const manager = new McpManager(registry, {
    connectTimeoutMs: 30,
    reconnectDelaysMs: [10, 20],
    createConnection: () => {
      const transport = { closed: false, close: async () => { transport.closed = true; } };
      transports.push(transport);
      return { client: queue.shift() || new FakeClient({ connect: async () => { throw new Error('refused'); } }), transport };
    },
    ...opts,
  });
  return { manager, registry, transports };
}

test('a connect that times out closes the client and its transport', async () => {
  const hung = new FakeClient({ connect: () => new Promise(() => {}) });
  const { manager, registry, transports } = setup([hung]);

  await manager.reload();

  assert.equal(hung.closed, true);
  assert.equal(transports[0].closed, true);
  assert.deepEqual(registry.list(), []);
  await manager.stop();
});

test('a listTools failure after connecting closes the client', async () => {
  const broken = new FakeClient({ listTools: async () => { throw new Error('boom'); } });
  const { manager, transports } = setup([broken]);

  await manager.reload();

  assert.equal(broken.closed, true);
  assert.equal(transports[0].closed, true);
  await manager.stop();
});

test('a closed connection removes the tools and reconnects', async () => {
  const first = new FakeClient();
  const second = new FakeClient();
  const { manager, registry } = setup([first, second]);

  await manager.reload();
  assert.deepEqual(registry.list(), ['mcp_jira_search']);

  first.crash();
  assert.deepEqual(registry.list(), []);
  await assert.rejects(manager.callTool('jira', 'search', {}), /not connected/);

  await sleep(40);
  assert.deepEqual(registry.list(), ['mcp_jira_search']);
  second.callTool = async () => ({ content: 'ok' });
  assert.deepEqual(await manager.callTool('jira', 'search', {}), { content: 'ok' });
  await manager.stop();
});

test('a failed reconnect is retried with backoff', async () => {
  const first = new FakeClient();
  const refused = new FakeClient({ connect: async () => { throw new Error('refused'); } });
  const third = new FakeClient();
  const { manager, registry } = setup([first, refused, third]);

  await manager.reload();
  first.crash();
  await sleep(15);
  assert.equal(refused.closed, true);
  assert.deepEqual(registry.list(), []);

  await sleep(40);
  assert.deepEqual(registry.list(), ['mcp_jira_search']);
  await manager.stop();
});

test('reload closes the old client without treating it as a crash', async () => {
  let connects = 0;
  const { manager } = setup([], {
    createConnection: () => {
      connects++;
      const client = new FakeClient();
      // A real client fires onclose when closed; a deliberate close must not reconnect.
      client.close = async () => { client.closed = true; client.onclose?.(); };
      return { client, transport: { close: async () => {} } };
    },
  });

  await manager.reload();
  await manager.reload();
  await sleep(40);

  assert.equal(connects, 2);
  await manager.stop();
});

test('a "Not connected" error from a tool call drops the server', async () => {
  const first = new FakeClient({ callTool: async () => { throw new Error('Not connected'); } });
  const { manager, registry } = setup([first, new FakeClient()]);

  await manager.reload();
  await assert.rejects(manager.callTool('jira', 'search', {}), /Not connected/);

  assert.deepEqual(registry.list(), []);
  assert.equal(first.closed, true);
  await sleep(40);
  assert.deepEqual(registry.list(), ['mcp_jira_search']);
  await manager.stop();
});

test('refreshTools drops a server whose connection is closed', async () => {
  const first = new FakeClient();
  const { manager, registry } = setup([first]);

  await manager.reload();
  first.listTools = async () => { const e = new Error('Connection closed'); e.code = -32000; throw e; };
  await manager.refreshTools();

  assert.deepEqual(registry.list(), []);
  await manager.stop();
});
