// UNIT: src/web/routes/models.js — its route table, and nothing else.
//
// Handler behavior is covered end to end by the Playwright suite against a
// real database; what a split like this can silently break is registration,
// which fails as a 404 at runtime rather than anywhere visible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelsRoutes } from '../../src/web/routes/models.js';
import { routesOf } from './helpers.js';

const EXPECTED = [
  'GET /models',
  'POST /models',
  'PUT /models/:id',
  'POST /models/test',
  'DELETE /models/:id',
];

test('models registers exactly its own routes', () => {
  assert.deepEqual(routesOf(modelsRoutes()).sort(), [...EXPECTED].sort());
});

test('models registers no route twice', () => {
  const routes = routesOf(modelsRoutes());
  assert.equal(new Set(routes).size, routes.length);
});

test('models returns a fresh router each call', () => {
  // Mounted once per createWebServer; a shared instance would accumulate
  // duplicate handlers if the server were ever built twice.
  assert.notEqual(modelsRoutes(), modelsRoutes());
});
