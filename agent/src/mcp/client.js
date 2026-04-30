import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile } from 'node:fs/promises';
import config from '../config.js';

export class McpManager {
  #clients = new Map();
  #tools = new Map(); // serverName -> tool[]

  async start() {
    let mcpConfig;
    try {
      const data = await readFile(config.paths.mcpConfigFile, 'utf-8');
      mcpConfig = JSON.parse(data);
    } catch {
      console.log('[mcp] No mcp-config.json found, skipping MCP');
      return;
    }

    if (!mcpConfig.servers) return;

    for (const [name, serverDef] of Object.entries(mcpConfig.servers)) {
      await this.#connectServer(name, serverDef);
    }
  }

  async #connectServer(name, serverDef) {
    try {
      const transport = new StdioClientTransport({
        command: serverDef.command,
        args: serverDef.args || [],
        env: { ...process.env, ...(serverDef.env || {}) },
      });

      const client = new Client({ name: `dogeclaw-${name}`, version: '0.1.0' });
      await client.connect(transport);

      const { tools } = await client.listTools();
      this.#clients.set(name, client);
      this.#tools.set(name, tools || []);

      console.log(`[mcp] Connected to ${name}: ${(tools || []).length} tools`);
    } catch (err) {
      console.error(`[mcp] Failed to connect to ${name}:`, err.message);
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
