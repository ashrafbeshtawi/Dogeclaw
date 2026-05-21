-- Cron jobs are scheduled agent runs. A job is bound to an agent and to a
-- delivery target:
--   * Telegram-style jobs: channel_id + chat_id set, session_id NULL — the
--     dispatcher resolves the active session for that chat at fire time, and
--     pushes the assistant reply back through the channel.
--   * Web-style jobs: session_id set, chat_id/channel_id NULL — the assistant
--     reply lands in the session and is shown next time the user opens it
--     (no push). When the session is deleted, the job is deleted too.
-- A job fires on either a cron expression (recurring) or a run_at timestamp
-- (one-shot, auto-disabled after firing). Exactly one of the two is required.

CREATE TABLE IF NOT EXISTS cron_jobs (
  id            SERIAL      PRIMARY KEY,
  agent_id      INTEGER     NOT NULL REFERENCES agents(id)   ON DELETE CASCADE,
  channel_id    INTEGER              REFERENCES channels(id) ON DELETE CASCADE,
  chat_id       TEXT,
  session_id    TEXT                 REFERENCES sessions(id) ON DELETE CASCADE,
  expression    TEXT,
  run_at        TIMESTAMPTZ,
  timezone      TEXT        NOT NULL DEFAULT 'UTC',
  description   TEXT        NOT NULL DEFAULT '',
  prompt        TEXT        NOT NULL,
  enabled       BOOLEAN     NOT NULL DEFAULT true,
  last_run_at   TIMESTAMPTZ,
  last_status   TEXT,
  last_error    TEXT,
  run_count     INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cron_jobs_schedule_xor
    CHECK ((expression IS NULL) <> (run_at IS NULL)),
  CONSTRAINT cron_jobs_target_xor
    CHECK ((chat_id IS NULL) <> (session_id IS NULL)),
  CONSTRAINT cron_jobs_channel_required_for_chat
    CHECK (chat_id IS NULL OR channel_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS cron_jobs_enabled_idx
  ON cron_jobs (enabled) WHERE enabled;

CREATE INDEX IF NOT EXISTS cron_jobs_run_at_idx
  ON cron_jobs (run_at) WHERE run_at IS NOT NULL AND enabled;
