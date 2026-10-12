-- next_run_at is the single source of truth for when a cron job runs next.
-- The runner claims a due run by moving next_run_at forward in one guarded
-- UPDATE, so a run starts exactly once no matter how many ticks or
-- instances see it due. NULL means "not planned yet": the runner plans new
-- and edited jobs, and every existing row, on its next tick — no backfill
-- here, because the next run of a cron expression is computed in the app.

ALTER TABLE cron_jobs ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ;

DROP INDEX IF EXISTS cron_jobs_run_at_idx;

CREATE INDEX IF NOT EXISTS cron_jobs_next_run_at_idx
  ON cron_jobs (next_run_at) WHERE enabled;
