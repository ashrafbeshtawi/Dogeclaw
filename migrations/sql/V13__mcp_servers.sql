-- MCP server registry: admin-managed connections to Model Context Protocol
-- servers, replacing the workspace mcp-config.json file. Moving the config
-- into Postgres puts it behind the admin UI's auth — the workspace file was
-- writable by the agent's own file_operation tool, i.e. the agent could
-- grant itself arbitrary stdio commands by editing its own MCP config.
--
-- allowed_tools is the per-server tool allowlist:
--   NULL -> expose every tool the server offers
--   []   -> expose none (fresh servers start here; pick tools via the
--           admin UI's Discover button)
-- Deliberately NO grants to the restricted dogeclaw role: env may hold
-- secrets, and the agent must not be able to read its own tool sources.
--
-- name feeds the registered tool prefix (mcp_<name>_<tool>), so it must
-- stay a valid identifier fragment for LLM tool-name rules.

CREATE TABLE IF NOT EXISTS mcp_servers (
  id            SERIAL       PRIMARY KEY,
  name          TEXT         NOT NULL UNIQUE,
  command       TEXT         NOT NULL,
  args          JSONB        NOT NULL DEFAULT '[]'::jsonb,
  env           JSONB        NOT NULL DEFAULT '{}'::jsonb,
  allowed_tools JSONB,
  enabled       BOOLEAN      NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT mcp_servers_name_chk CHECK (name ~ '^[a-zA-Z0-9_-]+$')
);
