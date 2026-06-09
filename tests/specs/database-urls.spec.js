// Unit-style spec for the buildDatabaseUrls helper. The agent now derives
// both Postgres connection URLs (admin + restricted role) from the small
// POSTGRES_* primitive env vars instead of two separate DOGECLAW_*_DATABASE_URL
// env vars. This spec covers the helper in isolation.
//
// Pattern copied from media-placeholder.spec.js — ESM source, CJS test
// bundle, dynamic import().

const { test, expect } = require('@playwright/test');

let buildDatabaseUrls;
let AGENT_DB_USER;
let AGENT_DB_PASSWORD;

test.beforeAll(async () => {
  ({ buildDatabaseUrls, AGENT_DB_USER, AGENT_DB_PASSWORD } =
    await import('../../agent/src/lib/databaseUrls.js'));
});

test.describe('buildDatabaseUrls', () => {
  test('uses local-dev defaults when env is empty', () => {
    const { adminUrl, agentUrl } = buildDatabaseUrls({});
    expect(adminUrl).toBe('postgres://admin:changeme@postgres:5432/dogeclaw');
    expect(agentUrl).toBe('postgres://dogeclaw:dogeclaw-agent-pw@postgres:5432/dogeclaw');
  });

  test('exposes the restricted role constants', () => {
    expect(AGENT_DB_USER).toBe('dogeclaw');
    expect(AGENT_DB_PASSWORD).toBe('dogeclaw-agent-pw');
  });

  test('honors POSTGRES_* primitives for both URLs', () => {
    const { adminUrl, agentUrl } = buildDatabaseUrls({
      POSTGRES_HOST: 'db.internal',
      POSTGRES_PORT: '6432',
      POSTGRES_USER: 'ops',
      POSTGRES_PASSWORD: 'sup3r-secret',
      POSTGRES_DB: 'prod',
    });
    expect(adminUrl).toBe('postgres://ops:sup3r-secret@db.internal:6432/prod');
    // Restricted-role URL shares host/port/db but uses the hardcoded creds.
    expect(agentUrl).toBe('postgres://dogeclaw:dogeclaw-agent-pw@db.internal:6432/prod');
  });

  test('DOGECLAW_ADMIN_DATABASE_URL wins as override (v2.0.0 backward compat)', () => {
    const { adminUrl, agentUrl } = buildDatabaseUrls({
      POSTGRES_USER: 'ignored',
      POSTGRES_PASSWORD: 'ignored',
      DOGECLAW_ADMIN_DATABASE_URL: 'postgres://override:pw@host:1111/db',
    });
    expect(adminUrl).toBe('postgres://override:pw@host:1111/db');
    // The agent URL is still derived from primitives unless DOGECLAW_DATABASE_URL is also set.
    expect(agentUrl).toBe('postgres://dogeclaw:dogeclaw-agent-pw@postgres:5432/dogeclaw');
  });

  test('DOGECLAW_DATABASE_URL wins as override for the agent URL', () => {
    const { agentUrl } = buildDatabaseUrls({
      DOGECLAW_DATABASE_URL: 'postgres://dogeclaw:rotated@host:5432/db',
    });
    expect(agentUrl).toBe('postgres://dogeclaw:rotated@host:5432/db');
  });

  test('percent-encodes special characters in password and database name', () => {
    const { adminUrl } = buildDatabaseUrls({
      POSTGRES_USER: 'with space',
      POSTGRES_PASSWORD: 'p@ss/word:1',
      POSTGRES_DB: 'db name',
    });
    // `:` and `@` and `/` in user/password break URL parsing without encoding.
    expect(adminUrl).toBe('postgres://with%20space:p%40ss%2Fword%3A1@postgres:5432/db%20name');
  });
});
