// Thin wrapper around `docker exec dogeclaw-postgres psql` for tests that
// need to seed state the HTTP API doesn't expose (e.g. inserting a session
// row, since /api/sessions has no POST).

const { execSync } = require('node:child_process');

const CONTAINER = 'dogeclaw-postgres';
const USER = 'dogeclaw';
const DB = 'dogeclaw';

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
