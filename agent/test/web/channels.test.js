// UNIT: src/web/routes/channels.js — its route table, and nothing else.
//
// Handler behavior is covered end to end by the Playwright suite against a
// real database; what a split like this can silently break is registration,
// which fails as a 404 at runtime rather than anywhere visible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { channelsRoutes } from '../../src/web/routes/channels.js';
import { routesOf } from './helpers.js';

const EXPECTED = [
  'GET /channels',
  'GET /telegram/commands',
  'GET /channels/:id/runtime',
  'POST /channels',
  'PUT /channels/:id',
  'DELETE /channels/:id',
];

test('channels registers exactly its own routes', () => {
  assert.deepEqual(routesOf(channelsRoutes()).sort(), [...EXPECTED].sort());
});

test('channels registers no route twice', () => {
  const routes = routesOf(channelsRoutes());
  assert.equal(new Set(routes).size, routes.length);
});

test('channels returns a fresh router each call', () => {
  // Mounted once per createWebServer; a shared instance would accumulate
  // duplicate handlers if the server were ever built twice.
  assert.notEqual(channelsRoutes(), channelsRoutes());
});
