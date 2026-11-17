import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { listEnabledServers } from '../db/mcpServers.js';
import { registerMcpTools } from '../tools/mcp.js';

// A hung `npx` (or a server that connects but never answers listTools) must
// not wedge boot or an admin HTTP request forever.
const CONNECT_TIMEOUT_MS = 20000;

// A server whose connection drops (crash, restart) is reconnected after these
// delays; the last one repeats until it is back or the next admin reload.
const RECONNECT_DELAYS_MS = [5000, 30000, 120000];

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

function createConnection(def) {
  return {
    client: new Client({ name: `dogeclaw-${def.name}`, version: '0.1.0' }),
    transport: buildTransport(def),
  };
}

function withTimeout(promise, label, ms = CONNECT_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// What the SDK throws once a client's transport is gone.
function isDisconnected(err) {
  return err?.code === ErrorCode.ConnectionClosed || /not connected/i.test(err?.message || '');
}

// A deliberate close must not look like a crash to the onclose handler.
async function closeQuietly(client) {
  client.onclose = undefined;
  try { await client.close(); } catch {}
}

// A connected server can change its tool set at any time — the very reason
// the per-tool allowlist was removed. Between admin reloads the registry is
// kept honest by a slow periodic re-list (below) and by the admin UI's
// Discover button, which triggers an explicit refresh.
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export class McpManager {
  #registry;
  #createConnection;
  #connectTimeoutMs;
  #reconnectDelaysMs;
  #clients = new Map();
  #tools = new Map(); // serverName -> tool[] (all tools the server offers)
  #descriptions = new Map(); // serverName -> admin-written description
  #servers = new Map(); // serverName -> DB definition, kept for reconnects
  #reconnectTimers = new Map(); // serverName -> pending reconnect
  #generation = 0; // bumped by reload()/stop(), so stale connects drop out
  #refreshTimer = null;

  // The options exist for tests: a fake connection factory and short timings.
  constructor(registry, {
    createConnection: connect = createConnection,
    connectTimeoutMs = CONNECT_TIMEOUT_MS,
    reconnectDelaysMs = RECONNECT_DELAYS_MS,
  } = {}) {
    this.#registry = registry;
    this.#createConnection = connect;
    this.#connectTimeoutMs = connectTimeoutMs;
    this.#reconnectDelaysMs = reconnectDelaysMs;
  }

  async start() {
    await this.reload();
    this.#refreshTimer = setInterval(() => {
      this.refreshTools().catch(e => console.error('[mcp] tool refresh failed:', e.message));
    }, REFRESH_INTERVAL_MS);
  }

  // Re-list every connected server's tools and re-register the registry's
  // mcp_ entries when anything changed. A transient failure keeps the last
  // known set — a flaky server must not wipe its tools between reloads — but
  // a closed connection drops the server and starts reconnecting.
  async refreshTools() {
    let changed = false;
    for (const [name, client] of this.#clients) {
      try {
        const { tools } = await withTimeout(client.listTools(), `listTools on ${name}`, this.#connectTimeoutMs);
        const fresh = tools || [];
        if (JSON.stringify(fresh) !== JSON.stringify(this.#tools.get(name))) {
          this.#tools.set(name, fresh);
          changed = true;
          console.log(`[mcp] ${name}: tool set changed — now ${fresh.length} tools`);
        }
      } catch (err) {
        if (isDisconnected(err)) {
          this.#handleClose(name, client);
        } else {
          console.error(`[mcp] ${name}: tool refresh failed, keeping last known set: ${err.message}`);
        }
      }
    }
    if (changed) this.#registerTools();
    return changed;
  }

  // Tear everything down and rebuild from the DB. Called at boot and after
  // every admin change to the mcp_servers table.
  async reload() {
    const generation = ++this.#generation;
    this.#cancelReconnects();
    for (const client of this.#clients.values()) {
      await closeQuietly(client);
    }
    this.#clients.clear();
    this.#tools.clear();
    this.#descriptions.clear();
    this.#servers.clear();
    for (const name of this.#registry.list()) {
      if (name.startsWith('mcp_')) this.#registry.unregister(name);
    }

    const servers = await listEnabledServers();
    for (const server of servers) {
      await this.#connectServer(server, generation);
    }
    if (generation === this.#generation) registerMcpTools(this.#registry, this);
  }

  // Returns whether the server is connected now.
  async #connectServer(server, generation) {
    const { client, transport } = this.#createConnection(server);
    try {
      await withTimeout(client.connect(transport), `connect to ${server.name}`, this.#connectTimeoutMs);
      client.onclose = () => this.#handleClose(server.name, client);
      client.onerror = err => console.error(`[mcp] ${server.name}: ${err?.message || err}`);

      // Every tool the server offers is exposed — MCP tool sets change
      // without notice, so a saved selection would silently rot. Access is
      // controlled per agent instead (agent_mcp_servers).
      const { tools } = await withTimeout(client.listTools(), `listTools on ${server.name}`, this.#connectTimeoutMs);
      if (generation !== this.#generation) {
        // A reload or stop ran meanwhile and owns the server list now.
        await closeQuietly(client);
        return false;
      }
      this.#clients.set(server.name, client);
      this.#tools.set(server.name, tools || []);
      this.#descriptions.set(server.name, server.description || '');
      this.#servers.set(server.name, server);

      console.log(`[mcp] Connected to ${server.name}: ${(tools || []).length} tools exposed`);
      return true;
    } catch (err) {
      console.error(`[mcp] Failed to connect to ${server.name}:`, err.message);
      // Close what was started, or a stdio server keeps running as an orphan.
      await closeQuietly(client);
      try { await transport.close(); } catch {}
      return false;
    }
  }

  // The connection went away on its own (server crashed or restarted): drop
  // its tools so agents stop calling them, and try to get it back.
  #handleClose(name, client) {
    if (this.#clients.get(name) !== client) return; // already dropped or replaced
    console.error(`[mcp] ${name}: connection closed, tools removed until it reconnects`);
    this.#clients.delete(name);
    this.#tools.delete(name);
    closeQuietly(client);
    this.#registerTools();
    this.#scheduleReconnect(this.#servers.get(name), 0);
  }

  #scheduleReconnect(server, attempt) {
    const delays = this.#reconnectDelaysMs;
    const delay = delays[Math.min(attempt, delays.length - 1)];
    const generation = this.#generation;
    const timer = setTimeout(async () => {
      this.#reconnectTimers.delete(server.name);
      if (generation !== this.#generation) return;
      if (await this.#connectServer(server, generation)) {
        this.#registerTools();
      } else if (generation === this.#generation) {
        this.#scheduleReconnect(server, attempt + 1);
      }
    }, delay);
    timer.unref?.();
    this.#reconnectTimers.set(server.name, timer);
  }

  #cancelReconnects() {
    for (const timer of this.#reconnectTimers.values()) clearTimeout(timer);
    this.#reconnectTimers.clear();
  }

  #registerTools() {
    for (const name of this.#registry.list()) {
      if (name.startsWith('mcp_')) this.#registry.unregister(name);
    }
    registerMcpTools(this.#registry, this);
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
    try {
      return await client.callTool({ name: toolName, arguments: args });
    } catch (err) {
      if (isDisconnected(err)) this.#handleClose(serverName, client);
      throw err;
    }
  }

  async stop() {
    this.#generation++;
    if (this.#refreshTimer) clearInterval(this.#refreshTimer);
    this.#cancelReconnects();
    for (const client of this.#clients.values()) {
      await closeQuietly(client);
    }
  }
}
