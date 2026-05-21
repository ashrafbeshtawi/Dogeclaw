-- Move conversation state from JSON files on disk to the database.
-- One row per session; one row per message. Per-turn INSERTs replace
-- the previous read-modify-write of a JSON array, which raced under
-- concurrent agent.run() calls (e.g. user typing while a cron fires).

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT        PRIMARY KEY,
  agent_id      INTEGER     REFERENCES agents(id)   ON DELETE SET NULL,
  agent_name    TEXT,
  source        TEXT        NOT NULL DEFAULT 'web',
  channel_id    INTEGER     REFERENCES channels(id) ON DELETE SET NULL,
  channel_name  TEXT,
  chat_id       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_channel_chat_idx
  ON sessions (channel_id, chat_id, updated_at DESC)
  WHERE chat_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS session_messages (
  id          BIGSERIAL   PRIMARY KEY,
  session_id  TEXT        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role        TEXT        NOT NULL,
  content     TEXT        NOT NULL DEFAULT '',
  tool_calls  JSONB,
  thinking    TEXT,
  has_image   BOOLEAN     NOT NULL DEFAULT false,
  has_audio   BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS session_messages_session_idx
  ON session_messages (session_id, id);
