// Per-agent MCP visibility, pure functions over registry entries
// ({ name, definition, meta }) so the stdlib-only unit tests cover them.
// Built-in tools (no meta.mcpServer) are always visible; MCP tools only if
// the agent is assigned to their server. An unassigned server is visible
// to NO agent.

export function visibleEntries(entries, allowedServerNames) {
  const allowed = new Set(allowedServerNames || []);
  return entries.filter(e => !e.meta?.mcpServer || allowed.has(e.meta.mcpServer));
}

// Group the visible MCP entries by server for the system prompt:
// [{ name, description, entries }] in first-seen order.
export function mcpGroups(entries) {
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
