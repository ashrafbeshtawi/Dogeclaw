import pg from 'pg';
import config from '../config.js';

// DogeClaw's own tables live in `system`; `public` holds the agent's memory
// tables (see migrations/sql/V19__system_schema.sql). The admin role resolves
// system tables first so an agent-created table can't shadow one; the agent
// role resolves `public` first so its unqualified CREATE TABLE lands there.
export const SYSTEM_SCHEMA = 'system';
const ADMIN_SEARCH_PATH = `-c search_path=${SYSTEM_SCHEMA},public`;
const AGENT_SEARCH_PATH = `-c search_path=public,${SYSTEM_SCHEMA}`;

let adminPool = null;
let agentPool = null;

export function getAdminPool() {
  if (!adminPool) {
    if (!config.database.adminUrl) throw new Error('DOGECLAW_ADMIN_DATABASE_URL not set');
    adminPool = new pg.Pool({ connectionString: config.database.adminUrl, options: ADMIN_SEARCH_PATH });
  }
  return adminPool;
}

export function getAgentPool() {
  if (!agentPool) {
    if (!config.database.agentUrl) throw new Error('DOGECLAW_DATABASE_URL not set');
    agentPool = new pg.Pool({ connectionString: config.database.agentUrl, options: AGENT_SEARCH_PATH });
  }
  return agentPool;
}

/** Admin query — full access (web UI CRUD, migrations) */
export async function adminQuery(sql, params) {
  return getAdminPool().query(sql, params);
}

/** Agent query — restricted (read-only on config tables, full on own tables) */
export async function agentQuery(sql, params) {
  return getAgentPool().query(sql, params);
}

export async function shutdown() {
  if (adminPool) { await adminPool.end(); adminPool = null; }
  if (agentPool) { await agentPool.end(); agentPool = null; }
}
