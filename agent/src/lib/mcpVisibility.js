// Per-agent MCP visibility, pure functions over registry entries
// ({ name, definition, meta }) so the stdlib-only unit tests cover them.
//
// Why select in memory at all: the DB stores only server ASSIGNMENTS
// (agent_mcp_servers) — the tool catalog itself (names, schemas, handlers)
// is discovered live from the connected servers into the registry, because
// MCP tool sets change without notice. The per-agent DB read happens in
// db/mcpServers.js#getAgentMcpServerNames; these functions join its answer
// against the in-memory catalog.

// Built-in tools (no meta.mcpServer) are always visible; MCP tools only if
// the agent is assigned to their server. An unassigned server is visible
// to NO agent.
export function filterVisibleEntries(entries, allowedServerNames) {
  const allowed = new Set(allowedServerNames || []);
  return entries.filter(e => !e.meta?.mcpServer || allowed.has(e.meta.mcpServer));
}

// Group the visible MCP entries by server for the system prompt:
// [{ name, description, entries }] in first-seen order.
export function groupEntriesByServer(entries) {
  const groups = new Map();
  for (const e of entries) {
    const server = e.meta?.mcpServer;
    if (!server) continue;
    if (!groups.has(server)) {
      groups.set(server, { name: server, description: e.meta.serverDescription || '', entries: [] });
    }
    groups.get(server).entries.push(e);
  }
  return [...groups.values()];
}
