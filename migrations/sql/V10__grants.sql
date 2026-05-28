-- Extend the read-only grant to the event_logs table added in V9, so the
-- agent's query_database tool can introspect its own operational log.
-- Writes still go via the admin pool.

DO $$
BEGIN
  EXECUTE 'GRANT SELECT ON event_logs TO dogeclaw';
END
$$;
