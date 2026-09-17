// UNIT: src/web/routes/crons.js — its route table, and nothing else.
//
// Handler behavior is covered end to end by the Playwright suite against a
// real database; what a split like this can silently break is registration,
// which fails as a 404 at runtime rather than anywhere visible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cronsRoutes } from '../../src/web/routes/crons.js';
import { routesOf } from './helpers.js';

const EXPECTED = [
  'GET /cron-jobs',
  'GET /cron-jobs/:id',
  'POST /cron-jobs',
  'PUT /cron-jobs/:id',
  'DELETE /cron-jobs/:id',
];

test('crons registers exactly its own routes', () => {
  assert.deepEqual(routesOf(cronsRoutes()).sort(), [...EXPECTED].sort());
});

test('crons registers no route twice', () => {
  const routes = routesOf(cronsRoutes());
  assert.equal(new Set(routes).size, routes.length);
});

test('crons returns a fresh router each call', () => {
  // Mounted once per createWebServer; a shared instance would accumulate
  // duplicate handlers if the server were ever built twice.
  assert.notEqual(cronsRoutes(), cronsRoutes());
});
