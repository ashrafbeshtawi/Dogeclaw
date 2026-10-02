-- DogeClaw's own tables live in the `system` schema; `public` holds only the
-- tables the agent creates for its memory.
--
-- The schema itself and schema_migrations are created by the runner before
-- any migration runs (db/migrate.js), and both pools pin search_path
-- (db/pool.js): admin resolves `system, public`, the agent role
-- `public, system`. On a fresh install every earlier migration therefore
-- already created its tables in `system` and the moves below find nothing.
--
-- Grants travel with the tables; the agent role gets USAGE on `system` so
-- its existing read-only grants keep working. No CREATE: the agent's own
-- tables can only land in `public`.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'models', 'agents', 'skills', 'agent_skills', 'channels',
    'sessions', 'session_messages', 'cron_jobs', 'settings',
    'queued_messages', 'event_logs', 'mcp_servers', 'agent_mcp_servers',
    'search_engines', 'dogeclaw_flyway_history', 'flyway_schema_history'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA system', t);
    END IF;
  END LOOP;

  IF to_regtype('public.mcp_transport') IS NOT NULL THEN
    ALTER TYPE public.mcp_transport SET SCHEMA system;
  END IF;

  EXECUTE 'GRANT USAGE ON SCHEMA system TO dogeclaw';
  -- Same resolution for anyone connecting as the admin role by hand (psql).
  EXECUTE format('ALTER ROLE %I IN DATABASE %I SET search_path = system, public',
                 current_user, current_database());
END
$$;
