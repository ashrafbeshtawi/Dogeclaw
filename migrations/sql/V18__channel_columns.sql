-- Typed columns replace the channels.config JSONB bag:
--   token         — telegram bot token (secret)
--   allowed_users — telegram user ids allowed to talk to the bot
--   webhook_id    — stable webhook path segment, minted by the DB at INSERT
--                   and never changed afterwards. Renames can't strand
--                   Telegram on a dead path anymore (the failure mode that
--                   silenced bots twice), and the path is unguessable —
--                   /webhook/<name> accepted forged updates from anyone who
--                   knew the channel name.
--
-- BREAKING — deliberately no data migration: existing telegram channels
-- must be recreated in the admin UI (owner's call: recreating a handful of
-- channels beats shipping one-shot backfill code).
--
-- Grants: the restricted dogeclaw role had whole-table SELECT on channels
-- and models — including channels.config (bot tokens) and models.api_key.
-- The agent's raw SQL tool runs as that role, so a prompt-injected agent
-- could exfiltrate its own credentials. These are system-only tables: no
-- code path running as the agent role reads them, so the grant is revoked
-- entirely (same policy as mcp_servers/search_engines: the agent never
-- reads its own tool sources or keys).

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS token TEXT,
  ADD COLUMN IF NOT EXISTS allowed_users BIGINT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS webhook_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid();
ALTER TABLE channels DROP COLUMN IF EXISTS config;

DO $$
BEGIN
  EXECUTE 'REVOKE SELECT ON channels, models FROM dogeclaw';
END
$$;
