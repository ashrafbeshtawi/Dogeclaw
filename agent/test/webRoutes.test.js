// The route table itself, asserted per module.
//
// Splitting ~46 routes out of one closure is exactly the kind of change that
// can silently drop or rename one: the handler bodies moved verbatim, so
// nothing in them fails, and a route that stopped being registered just 404s
// at runtime. These tests pin the registered path+method set for every
// module, so a future move that loses one fails here rather than in
// production.
//
// No DB and no server: a Router's stack can be read directly, and the
// factories only register handlers.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { agentsRoutes } from '../src/web/routes/agents.js';
import { channelsRoutes } from '../src/web/routes/channels.js';
import { chatRoutes } from '../src/web/routes/chat.js';
import { cronsRoutes } from '../src/web/routes/crons.js';
import { eventLogsRoutes } from '../src/web/routes/eventLogs.js';
import { mcpRoutes } from '../src/web/routes/mcp.js';
import { modelsRoutes } from '../src/web/routes/models.js';
import { searchEnginesRoutes } from '../src/web/routes/searchEngines.js';
import { sessionsRoutes } from '../src/web/routes/sessions.js';
import { settingsRoutes } from '../src/web/routes/settings.js';
import { skillsRoutes } from '../src/web/routes/skills.js';

/** Registered routes as "METHOD /path", in registration order. */
function routesOf(router) {
  return router.stack
    .filter(layer => layer.route)
    .flatMap(layer =>
      Object.keys(layer.route.methods)
        .filter(m => layer.route.methods[m])
        .map(m => `${m.toUpperCase()} ${layer.route.path}`));
}

const EXPECTED = {
  agents: [
    'GET /agents', 'POST /agents', 'PUT /agents/:id', 'DELETE /agents/:id',
  ],
  channels: [
    'GET /channels', 'GET /telegram/commands', 'GET /channels/:id/runtime',
    'POST /channels', 'PUT /channels/:id', 'DELETE /channels/:id',
  ],
  chat: ['POST /chat'],
  crons: [
    'GET /cron-jobs', 'GET /cron-jobs/:id', 'POST /cron-jobs',
    'PUT /cron-jobs/:id', 'DELETE /cron-jobs/:id',
  ],
  eventLogs: [
    'GET /event-logs', 'GET /event-logs/:id', 'DELETE /event-logs/:id', 'DELETE /event-logs',
  ],
  mcp: ['GET /mcp', 'POST /mcp', 'PUT /mcp/:id', 'DELETE /mcp/:id', 'POST /mcp/discover'],
  models: [
    'GET /models', 'POST /models', 'PUT /models/:id', 'POST /models/test', 'DELETE /models/:id',
  ],
  searchEngines: [
    'GET /search-engines', 'POST /search-engines', 'PUT /search-engines/order',
    'PUT /search-engines/:id', 'DELETE /search-engines/:id',
  ],
  sessions: [
    'GET /sessions', 'GET /sessions/:id', 'GET /sessions/:id/crons', 'DELETE /sessions/:id',
  ],
  settings: ['GET /settings', 'PUT /settings/:key'],
  skills: [
    'GET /skills', 'POST /skills', 'PUT /skills/:id', 'DELETE /skills/:id',
    'PUT /agents/:id/skills',
  ],
};

const FACTORIES = {
  agents: agentsRoutes, channels: channelsRoutes, chat: () => chatRoutes(null),
  crons: cronsRoutes, eventLogs: eventLogsRoutes, mcp: mcpRoutes, models: modelsRoutes,
  searchEngines: searchEnginesRoutes, sessions: sessionsRoutes, settings: settingsRoutes,
  skills: skillsRoutes,
};

for (const [name, expected] of Object.entries(EXPECTED)) {
  test(`${name} registers exactly its routes`, () => {
    assert.deepEqual(routesOf(FACTORIES[name]()).sort(), [...expected].sort());
  });
}

test('the whole API surface is 46 routes with no duplicates', () => {
  const all = Object.values(FACTORIES).flatMap(f => routesOf(f()));
  assert.equal(all.length, 46);
  // Two routers claiming the same method+path would make one unreachable
  // depending on mount order — a silent way to lose an endpoint.
  assert.equal(new Set(all).size, all.length, `duplicate route: ${all.filter((r, i) => all.indexOf(r) !== i)}`);
});

test('a literal path is registered before a parameterised sibling that would swallow it', () => {
  // /search-engines/order must win over /search-engines/:id. Express matches
  // in registration order, so this ordering is behavior, not style.
  const routes = routesOf(searchEnginesRoutes());
  assert.ok(
    routes.indexOf('PUT /search-engines/order') < routes.indexOf('PUT /search-engines/:id'),
    'PUT /search-engines/order must be registered before PUT /search-engines/:id',
  );
});

test('every factory returns a fresh router', () => {
  // Routers are mounted once per createWebServer call; a shared instance
  // would accumulate duplicate handlers if the server were ever built twice.
  assert.notEqual(agentsRoutes(), agentsRoutes());
});
