-- Remote MCP servers: streamable-HTTP transport alongside stdio, for hosted
-- servers (no local process, auth via HTTP headers). Per-transport required
-- fields (stdio -> command, http -> url) are validated at the API layer,
-- so command loses its NOT NULL.

ALTER TABLE mcp_servers
  ADD COLUMN IF NOT EXISTS transport TEXT NOT NULL DEFAULT 'stdio',
  ADD COLUMN IF NOT EXISTS url TEXT,
  ADD COLUMN IF NOT EXISTS headers JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE mcp_servers ALTER COLUMN command DROP NOT NULL;

ALTER TABLE mcp_servers
  ADD CONSTRAINT mcp_servers_transport_chk CHECK (transport IN ('stdio', 'http'));
