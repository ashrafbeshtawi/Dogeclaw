-- Move the periodic-mode (batched) Telegram message buffer from JSON files
-- on disk to the database. Each row is one un-processed inbound message;
-- the per-channel timer claims a batch atomically via DELETE...RETURNING
-- and dispatches one agent run per chat.
--
-- File-based version had three problems the DB form removes:
--   * read-modify-write on a JSON file (concurrent enqueues could lose msgs)
--   * crash mid-writeFile left a half-written file → next read failed silently
--   * ON DELETE CASCADE wasn't possible — orphan queues after channel delete

CREATE TABLE IF NOT EXISTS queued_messages (
  id          BIGSERIAL   PRIMARY KEY,
  channel_id  INTEGER     NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  chat_id     TEXT        NOT NULL,
  user_id     TEXT,
  text        TEXT        NOT NULL DEFAULT '',
  images      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS queued_messages_channel_idx
  ON queued_messages (channel_id, created_at);

DO $$
BEGIN
  EXECUTE 'GRANT SELECT ON queued_messages TO dogeclaw';
END
$$;
