// Thin wrapper around `docker exec dogeclaw-postgres psql` for tests that
// need to seed state the HTTP API doesn't expose (e.g. inserting a session
// row, since /api/sessions has no POST).

const { execSync } = require('node:child_process');

const CONTAINER = 'dogeclaw-postgres';
// Use the bootstrap superuser, not the restricted `dogeclaw` role, so the
// helper can INSERT/DELETE freely. Tests don't need (or want) the agent
// role's grants applied to their seed/cleanup statements.
const USER = process.env.POSTGRES_USER || 'admin';
const DB = process.env.POSTGRES_DB || 'dogeclaw';

function psql(sql) {
  const out = execSync(
    `docker exec -i ${CONTAINER} psql -U ${USER} -d ${DB} -v ON_ERROR_STOP=1 -A -t -F '|'`,
    { input: sql, encoding: 'utf-8' },
  );
  return out.trim();
}

function psqlQuery(sql) {
  const lines = psql(sql).split('\n').filter(Boolean);
  return lines.map(l => l.split('|'));
}

module.exports = { psql, psqlQuery };
