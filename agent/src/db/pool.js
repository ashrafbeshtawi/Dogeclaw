import pg from 'pg';
import config from '../config.js';

let adminPool = null;
let agentPool = null;

export function getAdminPool() {
  if (!adminPool) {
    if (!config.database.adminUrl) throw new Error('DOGECLAW_ADMIN_DATABASE_URL not set');
    adminPool = new pg.Pool({ connectionString: config.database.adminUrl });
  }
  return adminPool;
}

export function getAgentPool() {
  if (!agentPool) {
    if (!config.database.agentUrl) throw new Error('DOGECLAW_DATABASE_URL not set');
    agentPool = new pg.Pool({ connectionString: config.database.agentUrl });
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
