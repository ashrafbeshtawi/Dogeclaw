-- Admin ("god") agents: an agent flagged is_admin gets the admin tool set
-- (tools/admin.js) — list, inspect, create and edit the other agents, read
-- their conversations, analyze their performance, and message them through
-- the normal agent pipeline. Every other agent never sees those tools.
--
-- Only an operator can grant the flag (admin UI / REST); the admin tools
-- themselves always create agents with is_admin = false and refuse to edit
-- admin agents, so an admin agent can neither promote nor reconfigure one.
--
-- Agent-to-agent messages reuse sessions/session_messages with
-- sessions.source = 'agent' — no new table needed.

ALTER TABLE agents ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
