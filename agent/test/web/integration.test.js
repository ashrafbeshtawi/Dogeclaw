// INTEGRATION: every route module together, as createWebServer mounts them.
//
// The per-module files each guard their own table. This one guards the
// properties that only exist once they are combined — which is where a split
// like this actually goes wrong.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { agentsRoutes } from '../../src/web/routes/agents.js';
import { channelsRoutes } from '../../src/web/routes/channels.js';
import { chatRoutes } from '../../src/web/routes/chat.js';
import { cronsRoutes } from '../../src/web/routes/crons.js';
import { eventLogsRoutes } from '../../src/web/routes/eventLogs.js';
import { mcpRoutes } from '../../src/web/routes/mcp.js';
import { modelsRoutes } from '../../src/web/routes/models.js';
import { searchEnginesRoutes } from '../../src/web/routes/searchEngines.js';
import { sessionsRoutes } from '../../src/web/routes/sessions.js';
import { settingsRoutes } from '../../src/web/routes/settings.js';
import { skillsRoutes } from '../../src/web/routes/skills.js';
import { routesOf } from './helpers.js';

// Mirrors the mount list in createWebServer.
const ALL = () => [
  agentsRoutes(), channelsRoutes(), chatRoutes(null), cronsRoutes(), eventLogsRoutes(),
  mcpRoutes(), modelsRoutes(), searchEnginesRoutes(), sessionsRoutes(), settingsRoutes(),
  skillsRoutes(),
];

const flatten = () => ALL().flatMap(routesOf);

test('the combined API surface is 46 routes', () => {
  // The count before the split. A module dropped from the mount list, or a
  // route lost in a future move, shows up here.
  assert.equal(flatten().length, 46);
});

test('no two modules claim the same route', () => {
  // Mounted at the same '/api' prefix, so a collision makes one unreachable
  // depending on mount order — a silent way to lose an endpoint.
  const all = flatten();
  const dupes = all.filter((r, i) => all.indexOf(r) !== i);
  assert.deepEqual(dupes, []);
});

test('the nested skills route does not collide with the agent it hangs off', () => {
  // PUT /agents/:id lives in agents.js and PUT /agents/:id/skills in
  // skills.js. Different segment counts, so both are reachable — but they are
  // the one pair that crosses module boundaries, so it is worth pinning.
  const all = flatten();
  assert.ok(all.includes('PUT /agents/:id'));
  assert.ok(all.includes('PUT /agents/:id/skills'));
});

test('every route is under a known resource prefix', () => {
  // Catches a path that lost its leading segment in a move, which would
  // otherwise mount somewhere unintended under /api.
  const KNOWN = [
    '/agents', '/channels', '/telegram', '/chat', '/cron-jobs', '/event-logs',
    '/mcp', '/models', '/search-engines', '/sessions', '/settings', '/skills',
  ];
  const stray = flatten().filter(r => {
    const path = r.split(' ')[1];
    return !KNOWN.some(p => path === p || path.startsWith(p + '/'));
  });
  assert.deepEqual(stray, []);
});

test('mounting twice yields independent routers', () => {
  // createWebServer can be called more than once in a process (tests do it);
  // shared router instances would double every handler on the second build.
  const first = ALL();
  const second = ALL();
  first.forEach((r, i) => assert.notEqual(r, second[i]));
  assert.equal(flatten().length, 46);
});
