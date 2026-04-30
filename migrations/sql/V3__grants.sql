-- Grant the restricted dogeclaw role:
--   - CONNECT on this database
--   - SELECT on config tables (read-only access for the agent)
--   - USAGE + CREATE on schema public (so the agent can manage its own tables)

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO dogeclaw', current_database());
  EXECUTE 'GRANT SELECT ON models, agents, channels, skills, agent_skills TO dogeclaw';
  EXECUTE 'GRANT USAGE ON SCHEMA public TO dogeclaw';
  EXECUTE 'GRANT CREATE ON SCHEMA public TO dogeclaw';
END
$$;
