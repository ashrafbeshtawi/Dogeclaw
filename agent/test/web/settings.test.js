// UNIT: src/web/routes/settings.js — its route table, and nothing else.
//
// Handler behavior is covered end to end by the Playwright suite against a
// real database; what a split like this can silently break is registration,
// which fails as a 404 at runtime rather than anywhere visible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settingsRoutes } from '../../src/web/routes/settings.js';
import { routesOf } from './helpers.js';

const EXPECTED = [
  'GET /settings',
  'PUT /settings/:key',
];

test('settings registers exactly its own routes', () => {
  assert.deepEqual(routesOf(settingsRoutes()).sort(), [...EXPECTED].sort());
});

test('settings registers no route twice', () => {
  const routes = routesOf(settingsRoutes());
  assert.equal(new Set(routes).size, routes.length);
});

test('settings returns a fresh router each call', () => {
  // Mounted once per createWebServer; a shared instance would accumulate
  // duplicate handlers if the server were ever built twice.
  assert.notEqual(settingsRoutes(), settingsRoutes());
});
