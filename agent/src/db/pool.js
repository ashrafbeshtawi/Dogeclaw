import pg from 'pg';
import config from '../config.js';

// DogeClaw's own tables live in `system`; `public` holds the agent's memory
// tables (see migrations/sql/V19__system_schema.sql). Everything DogeClaw
// itself queries runs as admin, which resolves system tables first so an
// agent-created table can't shadow one. Only SQL that comes from the agent
// (the db_ tools) runs as the agent role, which has no access to `system`.
export const SYSTEM_SCHEMA = 'system';
const ADMIN_SEARCH_PATH = `-c search_path=${SYSTEM_SCHEMA},public`;
// Agent SQL is model-written: a runaway query or a forgotten open transaction
// must not hold the session lock forever. Admin queries keep no limit.
export const AGENT_STATEMENT_TIMEOUT_MS = 30_000;
const AGENT_OPTIONS = [
  '-c search_path=public',
  `-c statement_timeout=${AGENT_STATEMENT_TIMEOUT_MS}`,
  '-c idle_in_transaction_session_timeout=60000',
].join(' ');

let adminPool = null;
let agentPool = null;

// pg-pool emits 'error' when Postgres ends an idle client, e.g. the agent's
// open transaction after idle_in_transaction_session_timeout (25P03). Without
// a listener that is an uncaught exception that stops the whole process; with
// one, the pool only drops that client.
function logIdleClientErrors(pool, name) {
  pool.on('error', (err) => {
    console.error(`[db] ${name} pool: idle client error: ${err.message}`);
  });
  return pool;
}

export function getAdminPool() {
  if (!adminPool) {
    if (!config.database.adminUrl) throw new Error('DOGECLAW_ADMIN_DATABASE_URL not set');
    adminPool = logIdleClientErrors(
      new pg.Pool({ connectionString: config.database.adminUrl, options: ADMIN_SEARCH_PATH }),
      'admin',
    );
  }
  return adminPool;
}

export function getAgentPool() {
  if (!agentPool) {
    if (!config.database.agentUrl) throw new Error('DOGECLAW_DATABASE_URL not set');
    agentPool = logIdleClientErrors(
      new pg.Pool({ connectionString: config.database.agentUrl, options: AGENT_OPTIONS }),
      'agent',
    );
  }
  return agentPool;
}

/** Admin query — full access (web UI CRUD, migrations) */
export async function adminQuery(sql, params) {
  return getAdminPool().query(sql, params);
}

/** Agent query — the agent's own SQL; sees only the public schema */
export async function agentQuery(sql, params) {
  return getAgentPool().query(sql, params);
}

export async function shutdown() {
  if (adminPool) { await adminPool.end(); adminPool = null; }
  if (agentPool) { await agentPool.end(); agentPool = null; }
}
