// Coverage for the in-process migration runner. We can't easily test it
// in isolation because it speaks Postgres, but the live test stack already
// has a fully-migrated DB so we can probe its state and re-run the runner
// to confirm it's a no-op.

const { test, expect } = require('@playwright/test');
const { psql, psqlQuery } = require('../helpers/db.js');

test.describe('migration runner', () => {
  test('every V*.sql under migrations/sql has a matching schema_migrations row', async () => {
    // The agent boots and applies migrations before serving HTTP, so by the
    // time Playwright has logged in (global setup) the table exists.
    const fs = require('node:fs');
    const path = require('node:path');
    const dir = path.resolve(__dirname, '../../migrations/sql');
    const fileVersions = fs.readdirSync(dir)
      .map(f => {
        const m = f.match(/^V(\d+)__/);
        return m ? Number(m[1]) : null;
      })
      .filter(Boolean)
      .sort((a, b) => a - b);

    const rows = psqlQuery('SELECT version FROM schema_migrations ORDER BY version;');
    const dbVersions = rows.map(r => Number(r[0])).filter(Number.isFinite);

    expect(dbVersions).toEqual(fileVersions);
  });

  test('schema_migrations bookkeeping has version, name, applied_at', async () => {
    const cols = psqlQuery(`
      SELECT column_name
        FROM information_schema.columns
       WHERE table_name = 'schema_migrations'
       ORDER BY ordinal_position;
    `).map(r => r[0]);
    expect(cols).toEqual(['version', 'name', 'applied_at']);
  });

  test('DogeClaw tables live in the system schema, public is left to the agent', async () => {
    const inPublic = psqlQuery(`
      SELECT c.relname FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND pg_get_userbyid(c.relowner) <> 'dogeclaw';
    `).map(r => r[0]);
    expect(inPublic).toEqual([]);

    const inSystem = psqlQuery(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'system' ORDER BY tablename;
    `).map(r => r[0]);
    expect(inSystem).toEqual(expect.arrayContaining(['agents', 'schema_migrations', 'sessions', 'skills']));
  });

  test('agent role creates its tables in public', async () => {
    const out = psql(`
      SET ROLE dogeclaw;
      SET search_path = public;
      CREATE TABLE schema_probe (id int);
      SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'schema_probe';
      DROP TABLE schema_probe;
    `);
    expect(out.split('\n').filter(Boolean)).toEqual(['SET', 'SET', 'CREATE TABLE', 'public', 'DROP TABLE']);
  });

  test('agent role has no access to the system schema', async () => {
    for (const table of ['skills', 'agents', 'sessions', 'channels', 'models']) {
      expect(() => psql(`SET ROLE dogeclaw; SELECT 1 FROM system.${table} LIMIT 1;`))
        .toThrow(/permission denied for schema system/);
    }
  });

  test('runner is idempotent (no new rows after a second invocation)', async ({ request }) => {
    const before = psqlQuery('SELECT COUNT(*) FROM schema_migrations;')[0][0];
    // Force an agent restart so its main() re-runs runMigrations(). The
    // healthcheck/login probe returns once HTTP is serving, which only
    // happens AFTER migrations complete — so when we get a 200 below we
    // know the second migration pass ran cleanly.
    const { execSync } = require('node:child_process');
    execSync('docker restart dogeclaw', { stdio: 'pipe' });
    // Poll for /login to be reachable again.
    const t0 = Date.now();
    while (Date.now() - t0 < 30_000) {
      try {
        const r = await request.get('/login');
        if (r.ok()) break;
      } catch {}
      await new Promise(res => setTimeout(res, 500));
    }
    const after = psqlQuery('SELECT COUNT(*) FROM schema_migrations;')[0][0];
    expect(after).toBe(before);
  });
});
