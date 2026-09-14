import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { listEnabledServers } from '../db/mcpServers.js';
import { registerMcpTools } from '../tools/mcp.js';

// A hung `npx` (or a server that connects but never answers listTools) must
// not wedge boot or an admin HTTP request forever.
const CONNECT_TIMEOUT_MS = 20000;

// def: { transport: 'stdio'|'http', command/args/env | url/headers }
function buildTransport(def) {
  if (def.transport === 'http') {
    return new StreamableHTTPClientTransport(new URL(def.url), {
      requestInit: { headers: def.headers || {} },
    });
  }
  return new StdioClientTransport({
    command: def.command,
    args: def.args || [],
    env: { ...process.env, ...(def.env || {}) },
  });
}

function withTimeout(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${CONNECT_TIMEOUT_MS / 1000}s`)), CONNECT_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// A connected server can change its tool set at any time — the very reason
// the per-tool allowlist was removed. Between admin reloads the registry is
// kept honest by a slow periodic re-list (below) and by the admin UI's
// Discover button, which triggers an explicit refresh.
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export class McpManager {
  #registry;
  #clients = new Map();
  #tools = new Map(); // serverName -> tool[] (all tools the server offers)
  #descriptions = new Map(); // serverName -> admin-written description
  #refreshTimer = null;

  constructor(registry) {
    this.#registry = registry;
  }

  async start() {
    await this.reload();
    this.#refreshTimer = setInterval(() => {
      this.refreshTools().catch(e => console.error('[mcp] tool refresh failed:', e.message));
    }, REFRESH_INTERVAL_MS);
  }

  // Re-list every connected server's tools and re-register the registry's
  // mcp_ entries when anything changed. A transient failure keeps the last
  // known set — a flaky server must not wipe its tools between reloads.
  async refreshTools() {
    let changed = false;
    for (const [name, client] of this.#clients) {
      try {
        const { tools } = await withTimeout(client.listTools(), `listTools on ${name}`);
        const fresh = tools || [];
        if (JSON.stringify(fresh) !== JSON.stringify(this.#tools.get(name))) {
          this.#tools.set(name, fresh);
          changed = true;
          console.log(`[mcp] ${name}: tool set changed — now ${fresh.length} tools`);
        }
      } catch (err) {
        console.error(`[mcp] ${name}: tool refresh failed, keeping last known set: ${err.message}`);
      }
    }
    if (changed) {
      for (const name of this.#registry.list()) {
        if (name.startsWith('mcp_')) this.#registry.unregister(name);
      }
      registerMcpTools(this.#registry, this);
    }
    return changed;
  }

  // Tear everything down and rebuild from the DB. Called at boot and after
  // every admin change to the mcp_servers table.
  async reload() {
    for (const client of this.#clients.values()) {
      try { await client.close(); } catch {}
    }
    this.#clients.clear();
    this.#tools.clear();
    this.#descriptions.clear();
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
      const transport = buildTransport(server);
      const client = new Client({ name: `dogeclaw-${server.name}`, version: '0.1.0' });
      await withTimeout(client.connect(transport), `connect to ${server.name}`);

      // Every tool the server offers is exposed — MCP tool sets change
      // without notice, so a saved selection would silently rot. Access is
      // controlled per agent instead (agent_mcp_servers).
      const { tools } = await withTimeout(client.listTools(), `listTools on ${server.name}`);
      this.#clients.set(server.name, client);
      this.#tools.set(server.name, tools || []);
      this.#descriptions.set(server.name, server.description || '');

      console.log(`[mcp] Connected to ${server.name}: ${(tools || []).length} tools exposed`);
    } catch (err) {
      console.error(`[mcp] Failed to connect to ${server.name}:`, err.message);
    }
  }

  // Ephemeral connect for the admin UI's Discover button: list what a server
  // definition offers without touching the persistent connections. Throws on
  // failure — the API layer turns that into a 400 the UI can display.
  async discover(def) {
    const transport = buildTransport(def);
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

  getServerDescription(serverName) {
    return this.#descriptions.get(serverName) || '';
  }

  async callTool(serverName, toolName, args) {
    const client = this.#clients.get(serverName);
    if (!client) throw new Error(`MCP server ${serverName} not connected`);
    const result = await client.callTool({ name: toolName, arguments: args });
    return result;
  }

  async stop() {
    if (this.#refreshTimer) clearInterval(this.#refreshTimer);
    for (const client of this.#clients.values()) {
      try { await client.close(); } catch {}
    }
  }
}
