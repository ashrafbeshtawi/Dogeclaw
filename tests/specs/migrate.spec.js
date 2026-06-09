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
