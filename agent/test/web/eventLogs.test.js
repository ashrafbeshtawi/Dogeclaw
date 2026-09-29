// UNIT: src/web/routes/eventLogs.js — its route table, and nothing else.
//
// Handler behavior is covered end to end by the Playwright suite against a
// real database; what a split like this can silently break is registration,
// which fails as a 404 at runtime rather than anywhere visible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventLogsRoutes } from '../../src/web/routes/eventLogs.js';
import { routesOf } from './helpers.js';

const EXPECTED = [
  'GET /event-logs',
  'GET /event-logs/:id',
  'DELETE /event-logs/:id',
  'DELETE /event-logs',
];

test('eventLogs registers exactly its own routes', () => {
  assert.deepEqual(routesOf(eventLogsRoutes()).sort(), [...EXPECTED].sort());
});

test('eventLogs registers no route twice', () => {
  const routes = routesOf(eventLogsRoutes());
  assert.equal(new Set(routes).size, routes.length);
});

test('eventLogs returns a fresh router each call', () => {
  // Mounted once per createWebServer; a shared instance would accumulate
  // duplicate handlers if the server were ever built twice.
  assert.notEqual(eventLogsRoutes(), eventLogsRoutes());
});
