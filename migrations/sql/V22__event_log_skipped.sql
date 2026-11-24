-- cron_run rows get a third status: 'skipped', written when a slot comes due
-- while the job's previous run is still going (see src/cron/runner.js).

ALTER TABLE event_logs DROP CONSTRAINT IF EXISTS event_logs_status_chk;
ALTER TABLE event_logs ADD CONSTRAINT event_logs_status_chk
  CHECK (status IN ('success', 'error', 'skipped'));
