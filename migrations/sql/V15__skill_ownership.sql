-- Agent-created skills: created_by_agent_id marks ownership. NULL = created
-- by a human in the admin UI. Agents may create skills and edit/delete only
-- the ones they created; enforcement lives in the skill tool handlers, which
-- run on the admin connection. Deliberately NO new grants to the restricted
-- dogeclaw role — it keeps SELECT-only on skills, so the agent's raw SQL
-- tool cannot bypass the ownership check.
--
-- ON DELETE CASCADE: an agent's own skills die with the agent. SET NULL
-- would silently flip them to "no assignments = public", leaking a private
-- skill to every other agent.
ALTER TABLE skills ADD COLUMN IF NOT EXISTS
  created_by_agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE;
