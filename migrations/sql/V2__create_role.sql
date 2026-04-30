-- Create the restricted role used by the DogeClaw agent's query_database tool.
-- The agent connects with this role; it has read-only access to config tables
-- (granted in V3) plus USAGE/CREATE on the public schema so it can manage its
-- own working tables.
--
-- The password here is a sensible default for dev. Operators should rotate it
-- in prod by running: ALTER ROLE dogeclaw WITH PASSWORD '<new>';
-- and updating DOGECLAW_DATABASE_URL accordingly.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dogeclaw') THEN
    CREATE ROLE dogeclaw WITH LOGIN PASSWORD 'dogeclaw-agent-pw';
  END IF;
END
$$;
