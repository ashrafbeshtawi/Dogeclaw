-- Extend the read-only grant established in V3 to the tables added in
-- V4–V6, so the agent's query_database tool can introspect sessions,
-- messages, cron jobs, and settings. Writes still go via the admin pool.

DO $$
BEGIN
  EXECUTE 'GRANT SELECT ON sessions, session_messages, cron_jobs, settings TO dogeclaw';
END
$$;
