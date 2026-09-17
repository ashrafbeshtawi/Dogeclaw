// UNIT: src/web/routes/skills.js — its route table, and nothing else.
//
// Handler behavior is covered end to end by the Playwright suite against a
// real database; what a split like this can silently break is registration,
// which fails as a 404 at runtime rather than anywhere visible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skillsRoutes } from '../../src/web/routes/skills.js';
import { routesOf } from './helpers.js';

const EXPECTED = [
  'GET /skills',
  'POST /skills',
  'PUT /skills/:id',
  'DELETE /skills/:id',
  'PUT /agents/:id/skills',
];

test('skills registers exactly its own routes', () => {
  assert.deepEqual(routesOf(skillsRoutes()).sort(), [...EXPECTED].sort());
});

test('skills registers no route twice', () => {
  const routes = routesOf(skillsRoutes());
  assert.equal(new Set(routes).size, routes.length);
});

test('skills returns a fresh router each call', () => {
  // Mounted once per createWebServer; a shared instance would accumulate
  // duplicate handlers if the server were ever built twice.
  assert.notEqual(skillsRoutes(), skillsRoutes());
});
