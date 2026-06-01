-- Whisper transcription was removed in favour of a media-aware placeholder
-- (`[Attached: audio]`) plus optional pass-through to audio-capable LLMs
-- (Gemini inline_data). The two artifacts this leaves behind are:
--   1. `audio_transcription` rows in event_logs (one per voice message).
--   2. JSONB keys `transcript` and `transcription_event_id` on
--      session_messages.meta that pointed at those rows.
-- Both lose meaning the moment the feature is gone — purge them so the
-- admin UI's event list and the chat view aren't full of dangling links.

DELETE FROM event_logs
 WHERE kind = 'audio_transcription';

UPDATE session_messages
   SET meta = meta - 'transcript' - 'transcription_event_id'
 WHERE meta ? 'transcript'
    OR meta ? 'transcription_event_id';

-- Pairs with the new video media path. The chat view renders a 🎬 chip when
-- this flag is set; telegram.js sets it on inbound video / video_note.
ALTER TABLE session_messages
  ADD COLUMN IF NOT EXISTS has_video BOOLEAN NOT NULL DEFAULT false;
