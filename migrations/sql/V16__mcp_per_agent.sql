-- Per-agent MCP servers, replacing the per-server tool allowlist.
--
-- The allowlist selected individual tools, but MCP servers can change their
-- tool set without notice — a saved selection silently rots. Access control
-- moves up a level: a connected server exposes ALL of its tools, and only
-- agents explicitly assigned to the server see them. Unlike skills, an
-- unassigned server is visible to NO agent.
--
-- description is admin-written context shown in the agent's system prompt
-- (grouped: server name + description, its tools beneath).
--
-- Deliberately NO grants to the restricted dogeclaw role — same reasoning
-- as mcp_servers itself: the agent must not read or edit its own tool
-- sources. Assignment lookups run on the admin connection.

ALTER TABLE mcp_servers DROP COLUMN IF EXISTS allowed_tools;
ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS agent_mcp_servers (
  agent_id  INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  server_id INTEGER NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  PRIMARY KEY (agent_id, server_id)
);
