// In-process migration runner. Replaces the standalone Flyway image
// (dogeclaw-migrations) so the agent ships as a single container.
//
// Behaviour:
//   * Reads migrations/sql/V<n>__<name>.sql in numeric order.
//   * Each file is one transaction; on failure the migration is rolled
//     back and the runner throws — the agent process exits non-zero.
//   * Tracks applied versions in a `schema_migrations` table the runner
//     creates lazily on first boot.
//   * Serialises boot across multiple replicas via pg_advisory_lock so a
//     scaled-out deploy can't race on the same migration set.
//   * On the first v2 boot against a database that already has Flyway's
//     `flyway_schema_history`, imports the prior success rows into
//     `schema_migrations` so V1..V<latest> are not re-applied.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import config from '../config.js';
import { getAdminPool } from './pool.js';

// Arbitrary 32-bit signed int. Same key for every replica so they
// serialise on the same lock. Don't change this between releases.
const ADVISORY_LOCK_KEY = 0x42_06_C1_AA;
const FILE_PATTERN = /^V(\d+)__(.+)\.sql$/;

export async function runMigrations() {
  const pool = getAdminPool();
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    locked = true;

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER       PRIMARY KEY,
        name       TEXT          NOT NULL,
        applied_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      )
    `);

    await importFlywayHistoryIfPresent(client);

    const appliedRes = await client.query('SELECT version FROM schema_migrations');
    const applied = new Set(appliedRes.rows.map(r => Number(r.version)));

    const files = await loadMigrationFiles(config.paths.migrationsDir);
    let newlyApplied = 0;
    for (const m of files) {
      if (applied.has(m.version)) continue;
      console.log(`[migrate] applying V${m.version}: ${m.file}`);
      const sql = await readFile(join(config.paths.migrationsDir, m.file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
          [m.version, m.file],
        );
        await client.query('COMMIT');
        newlyApplied++;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`migration V${m.version} (${m.file}) failed: ${err.message}`);
      }
    }
    console.log(
      `[migrate] schema up to date — ${files.length} migrations total, ${newlyApplied} applied this boot`,
    );
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => {});
    }
    client.release();
  }
}

export async function loadMigrationFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`migrations directory not found: ${dir}`);
    }
    throw err;
  }
  return entries
    .map(file => {
      const m = file.match(FILE_PATTERN);
      return m ? { version: Number(m[1]), file } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.version - b.version);
}

// One-time bridge: if a prior Flyway service populated its history table
// (a v1.x DB upgrading to v2), copy its success rows into
// `schema_migrations` so the runner doesn't re-apply migrations that
// have already run. Idempotent — once schema_migrations has rows, this
// is a no-op. Checks both the custom `dogeclaw_flyway_history` (set by
// our shipped Flyway image) and the upstream default in case an operator
// overrode it.
const FLYWAY_HISTORY_CANDIDATES = ['dogeclaw_flyway_history', 'flyway_schema_history'];

async function importFlywayHistoryIfPresent(client) {
  const { rows: existingRows } = await client.query(
    'SELECT COUNT(*)::int AS n FROM schema_migrations',
  );
  if (existingRows[0].n > 0) return;

  let sourceTable = null;
  for (const candidate of FLYWAY_HISTORY_CANDIDATES) {
    const { rows } = await client.query(
      `SELECT to_regclass('public.' || $1::text) AS reg`,
      [candidate],
    );
    if (rows[0].reg) {
      sourceTable = candidate;
      break;
    }
  }
  if (!sourceTable) return;

  console.log(`[migrate] importing ${sourceTable} into schema_migrations`);
  await client.query(`
    INSERT INTO schema_migrations (version, name, applied_at)
    SELECT version::integer,
           script,
           COALESCE(installed_on, NOW())
      FROM ${sourceTable}
     WHERE success = true AND version IS NOT NULL
     ORDER BY installed_rank
    ON CONFLICT (version) DO NOTHING
  `);
}
