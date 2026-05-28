-- Unified events log: surfaces what the agent is actually doing so operators
-- can debug after the fact. Today we log:
--   * cron_run            — a cron job dispatched (input = trigger prompt,
--                           output = final assistant text, error on failure)
--   * audio_transcription — a Telegram voice/audio message was handed to the
--                           transcriber (input = mime + duration, output =
--                           transcript, error on failure)
-- Rows are pruned by a daily tick using the event_log_retention_days setting
-- (default 14). The admin UI also exposes manual delete.

CREATE TABLE IF NOT EXISTS event_logs (
  id           BIGSERIAL    PRIMARY KEY,
  kind         TEXT         NOT NULL,
  ref_id       TEXT,
  status       TEXT         NOT NULL,
  input        TEXT,
  output       TEXT,
  error        TEXT,
  duration_ms  INTEGER,
  meta         JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT event_logs_status_chk
    CHECK (status IN ('success', 'error'))
);

CREATE INDEX IF NOT EXISTS event_logs_kind_created_idx
  ON event_logs (kind, created_at DESC);

CREATE INDEX IF NOT EXISTS event_logs_created_idx
  ON event_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS event_logs_ref_idx
  ON event_logs (ref_id) WHERE ref_id IS NOT NULL;

-- Retention setting consumed by the cleanup tick. Operators can edit it from
-- the admin UI.
INSERT INTO settings (key, value)
VALUES ('event_log_retention_days', to_jsonb(14))
ON CONFLICT (key) DO NOTHING;
