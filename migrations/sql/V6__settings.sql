-- Global key/value settings. Used today for the default cron timezone; future
-- additions go here too. Singleton-ish: one row per key.

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT        PRIMARY KEY,
  value       JSONB       NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the timezone with the container's current setting so brand-new installs
-- match the host's TZ. Operators can override later via the admin UI.
INSERT INTO settings (key, value)
VALUES ('timezone', to_jsonb(current_setting('TIMEZONE')))
ON CONFLICT (key) DO NOTHING;
