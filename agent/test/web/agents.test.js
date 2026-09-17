// UNIT: src/web/routes/agents.js — its route table, and nothing else.
//
// Handler behavior is covered end to end by the Playwright suite against a
// real database; what a split like this can silently break is registration,
// which fails as a 404 at runtime rather than anywhere visible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentsRoutes } from '../../src/web/routes/agents.js';
import { routesOf } from './helpers.js';

const EXPECTED = [
  'GET /agents',
  'POST /agents',
  'PUT /agents/:id',
  'DELETE /agents/:id',
];

test('agents registers exactly its own routes', () => {
  assert.deepEqual(routesOf(agentsRoutes()).sort(), [...EXPECTED].sort());
});

test('agents registers no route twice', () => {
  const routes = routesOf(agentsRoutes());
  assert.equal(new Set(routes).size, routes.length);
});

test('agents returns a fresh router each call', () => {
  // Mounted once per createWebServer; a shared instance would accumulate
  // duplicate handlers if the server were ever built twice.
  assert.notEqual(agentsRoutes(), agentsRoutes());
});
