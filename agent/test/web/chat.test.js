// UNIT: src/web/routes/chat.js — its route table, and nothing else.
//
// Handler behavior is covered end to end by the Playwright suite against a
// real database; what a split like this can silently break is registration,
// which fails as a 404 at runtime rather than anywhere visible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatRoutes } from '../../src/web/routes/chat.js';
import { routesOf } from './helpers.js';

const EXPECTED = [
  'POST /chat',
];

test('chat registers exactly its own routes', () => {
  assert.deepEqual(routesOf(chatRoutes(null)).sort(), [...EXPECTED].sort());
});

test('chat registers no route twice', () => {
  const routes = routesOf(chatRoutes(null));
  assert.equal(new Set(routes).size, routes.length);
});

test('chat returns a fresh router each call', () => {
  // Mounted once per createWebServer; a shared instance would accumulate
  // duplicate handlers if the server were ever built twice.
  assert.notEqual(chatRoutes(null), chatRoutes(null));
});
