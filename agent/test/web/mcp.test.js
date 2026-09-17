// UNIT: src/web/routes/mcp.js — its route table, and nothing else.
//
// Handler behavior is covered end to end by the Playwright suite against a
// real database; what a split like this can silently break is registration,
// which fails as a 404 at runtime rather than anywhere visible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mcpRoutes } from '../../src/web/routes/mcp.js';
import { routesOf } from './helpers.js';

const EXPECTED = [
  'GET /mcp',
  'POST /mcp',
  'PUT /mcp/:id',
  'DELETE /mcp/:id',
  'POST /mcp/discover',
];

test('mcp registers exactly its own routes', () => {
  assert.deepEqual(routesOf(mcpRoutes()).sort(), [...EXPECTED].sort());
});

test('mcp registers no route twice', () => {
  const routes = routesOf(mcpRoutes());
  assert.equal(new Set(routes).size, routes.length);
});

test('mcp returns a fresh router each call', () => {
  // Mounted once per createWebServer; a shared instance would accumulate
  // duplicate handlers if the server were ever built twice.
  assert.notEqual(mcpRoutes(), mcpRoutes());
});
