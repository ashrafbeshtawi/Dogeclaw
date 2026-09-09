-- Search engine registry: admin-managed API credentials for the web search
-- tools, replacing both env-var configuration and the keyless DDG scrape.
--
-- provider: 'google' (Custom Search JSON API — needs api_key + cx) or
--           'brave'  (Brave Search API — needs api_key only).
-- enabled:  per-entry switch.
-- priority: lower = tried first; on provider failure the next enabled
--           engine takes over (see lib/searchProviders.js).
--
-- The web_search / web_research tools are only exposed to agents while at
-- least one enabled engine exists — no engines, no search tools.
--
-- Deliberately NO grants to the restricted dogeclaw role: api_key is a
-- secret and the agent must not read its own tool sources (same policy as
-- mcp_servers).

CREATE TABLE IF NOT EXISTS search_engines (
  id          SERIAL       PRIMARY KEY,
  provider    TEXT         NOT NULL CHECK (provider IN ('google', 'brave')),
  api_key     TEXT         NOT NULL,
  cx          TEXT,
  enabled     BOOLEAN      NOT NULL DEFAULT true,
  priority    INTEGER      NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT search_engines_google_cx_chk CHECK (provider <> 'google' OR cx IS NOT NULL)
);
