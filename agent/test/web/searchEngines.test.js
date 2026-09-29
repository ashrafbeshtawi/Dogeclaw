// UNIT: src/web/routes/searchEngines.js — its route table, and nothing else.
//
// Handler behavior is covered end to end by the Playwright suite against a
// real database; what a split like this can silently break is registration,
// which fails as a 404 at runtime rather than anywhere visible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchEnginesRoutes } from '../../src/web/routes/searchEngines.js';
import { routesOf } from './helpers.js';

const EXPECTED = [
  'GET /search-engines',
  'POST /search-engines',
  'PUT /search-engines/order',
  'PUT /search-engines/:id',
  'DELETE /search-engines/:id',
];

test('searchEngines registers exactly its own routes', () => {
  assert.deepEqual(routesOf(searchEnginesRoutes()).sort(), [...EXPECTED].sort());
});

test('searchEngines registers no route twice', () => {
  const routes = routesOf(searchEnginesRoutes());
  assert.equal(new Set(routes).size, routes.length);
});

test('searchEngines returns a fresh router each call', () => {
  // Mounted once per createWebServer; a shared instance would accumulate
  // duplicate handlers if the server were ever built twice.
  assert.notEqual(searchEnginesRoutes(), searchEnginesRoutes());
});

test('searchEngines keeps the literal path ahead of its parameterised sibling', () => {
  // Express matches in registration order, so this is behavior: 'PUT /search-engines/:id'
  // would otherwise swallow 'PUT /search-engines/order'.
  const routes = routesOf(searchEnginesRoutes());
  assert.ok(routes.indexOf('PUT /search-engines/order') < routes.indexOf('PUT /search-engines/:id'));
});
