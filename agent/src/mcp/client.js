import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { listEnabledServers } from '../db/mcpServers.js';
import { filterAllowedTools } from '../lib/mcpAllowlist.js';
import { registerMcpTools } from '../tools/mcp.js';

// A hung `npx` (or a server that connects but never answers listTools) must
// not wedge boot or an admin HTTP request forever.
const CONNECT_TIMEOUT_MS = 20000;

function withTimeout(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${CONNECT_TIMEOUT_MS / 1000}s`)), CONNECT_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class McpManager {
  #registry;
  #clients = new Map();
  #tools = new Map(); // serverName -> allowlisted tool[]

  constructor(registry) {
    this.#registry = registry;
  }

  async start() {
    await this.reload();
  }

  // Tear everything down and rebuild from the DB. Called at boot and after
  // every admin change to the mcp_servers table.
  async reload() {
    for (const client of this.#clients.values()) {
      try { await client.close(); } catch {}
    }
    this.#clients.clear();
    this.#tools.clear();
    for (const name of this.#registry.list()) {
      if (name.startsWith('mcp_')) this.#registry.unregister(name);
    }

    const servers = await listEnabledServers();
    for (const server of servers) {
      await this.#connectServer(server);
    }
    registerMcpTools(this.#registry, this);
  }

  async #connectServer(server) {
    try {
      const transport = new StdioClientTransport({
        command: server.command,
        args: server.args || [],
        env: { ...process.env, ...(server.env || {}) },
      });

      const client = new Client({ name: `dogeclaw-${server.name}`, version: '0.1.0' });
      await withTimeout(client.connect(transport), `connect to ${server.name}`);

      const { tools } = await withTimeout(client.listTools(), `listTools on ${server.name}`);
      const allowed = filterAllowedTools(tools || [], server.allowed_tools);
      this.#clients.set(server.name, client);
      this.#tools.set(server.name, allowed);

      console.log(`[mcp] Connected to ${server.name}: ${allowed.length}/${(tools || []).length} tools exposed`);
    } catch (err) {
      console.error(`[mcp] Failed to connect to ${server.name}:`, err.message);
    }
  }

  // Ephemeral connect for the admin UI's Discover button: list what a server
  // definition offers without touching the persistent connections. Throws on
  // failure — the API layer turns that into a 400 the UI can display.
  async discover({ command, args = [], env = {} }) {
    const transport = new StdioClientTransport({
      command,
      args,
      env: { ...process.env, ...env },
    });
    const client = new Client({ name: 'dogeclaw-discover', version: '0.1.0' });
    try {
      await withTimeout(client.connect(transport), 'connect');
      const { tools } = await withTimeout(client.listTools(), 'listTools');
      return (tools || []).map(t => ({ name: t.name, description: t.description || '' }));
    } finally {
      try { await client.close(); } catch {}
    }
  }

  getConnectedServers() {
    return this.#tools;
  }

  async callTool(serverName, toolName, args) {
    const client = this.#clients.get(serverName);
    if (!client) throw new Error(`MCP server ${serverName} not connected`);
    const result = await client.callTool({ name: toolName, arguments: args });
    return result;
  }

  async stop() {
    for (const client of this.#clients.values()) {
      try { await client.close(); } catch {}
    }
  }
}
