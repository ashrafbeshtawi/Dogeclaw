-- Per-message metadata, so we can attach context that the UI needs to render
-- richer message previews. Today this is used by Telegram voice/audio messages
-- to carry the inline transcript and a back-reference to the matching
-- event_logs row, so clicking a voice bubble in the admin chat view can open
-- the full transcription log.

ALTER TABLE session_messages
  ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;
