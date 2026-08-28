-- Remote MCP servers: streamable-HTTP transport alongside stdio, for hosted
-- servers (no local process, auth via HTTP headers). Per-transport required
-- fields (stdio -> command, http -> url) are validated at the API layer,
-- so command loses its NOT NULL.

CREATE TYPE mcp_transport AS ENUM ('stdio', 'http');

ALTER TABLE mcp_servers
  ADD COLUMN IF NOT EXISTS transport mcp_transport NOT NULL DEFAULT 'stdio',
  ADD COLUMN IF NOT EXISTS url TEXT,
  ADD COLUMN IF NOT EXISTS headers JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE mcp_servers ALTER COLUMN command DROP NOT NULL;
