// Builds the two Postgres connection strings the agent uses, from a small
// set of primitive env vars (POSTGRES_USER / PASSWORD / DB / HOST / PORT).
// This is the operator-facing config surface — see README.
//
// The restricted role's credentials are hardcoded here on purpose. They
// mirror migrations/sql/V2__create_role.sql, which CREATEs the role with
// the same password. Operators who want to rotate must do so against the
// live DB (ALTER ROLE) AND edit the constant below + rebuild — see the
// "Hardening" section of the README. We accept that cost to keep the
// runtime config surface minimal.
//
// DOGECLAW_ADMIN_DATABASE_URL and DOGECLAW_DATABASE_URL are honored as
// backward-compat overrides for anyone who already deployed v2.0.0 with
// the previous env-var contract. Not advertised in current docs.

export const AGENT_DB_USER = 'dogeclaw';
export const AGENT_DB_PASSWORD = 'dogeclaw-agent-pw';

const DEFAULTS = {
  host: 'postgres',
  port: '5432',
  user: 'admin',
  password: 'changeme',
  db: 'dogeclaw',
};

export function buildDatabaseUrls(env = process.env) {
  const host = env.POSTGRES_HOST     || DEFAULTS.host;
  const port = env.POSTGRES_PORT     || DEFAULTS.port;
  const user = env.POSTGRES_USER     || DEFAULTS.user;
  const pass = env.POSTGRES_PASSWORD || DEFAULTS.password;
  const db   = env.POSTGRES_DB       || DEFAULTS.db;

  const url = (u, p) =>
    `postgres://${encodeURIComponent(u)}:${encodeURIComponent(p)}@${host}:${port}/${encodeURIComponent(db)}`;

  return {
    adminUrl: env.DOGECLAW_ADMIN_DATABASE_URL || url(user, pass),
    agentUrl: env.DOGECLAW_DATABASE_URL       || url(AGENT_DB_USER, AGENT_DB_PASSWORD),
  };
}
