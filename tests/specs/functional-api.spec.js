// Functional API tests — exercise the HTTP contracts directly with
// Playwright's request fixture, no browser. The per-resource specs cover
// UI flows; this file covers what the API itself enforces:
//   1. auth gating on every /api surface
//   2. validation error contracts (400s) and missing-row 404s
//   3. cross-resource FK semantics and the skill-assignment endpoints
//
// Note the explicit `Accept: application/json` on unauthenticated calls —
// authMiddleware redirects Accept:*/* requests to /login (browser
// behavior) and only returns 401 to JSON clients.

const { test, expect, request: pwRequest } = require('@playwright/test');
const { uniqueName } = require('../helpers/ui');

const JSON_ACCEPT = { Accept: 'application/json' };
const MISSING_ID = 2000000000; // valid int4, never allocated

test.describe('auth gate on the API surface', () => {
  let anon;

  test.beforeAll(async () => {
    // Explicit empty storageState — inside the runner, newContext() inherits
    // the config's logged-in state and would silently authenticate us.
    anon = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: { cookies: [], origins: [] },
    });
  });
  test.afterAll(async () => anon.dispose());

  const ENDPOINTS = [
    ['get', '/api/config'],
    ['get', '/api/models'],
    ['get', '/api/agents'],
    ['get', '/api/skills'],
    ['get', '/api/channels'],
    ['get', '/api/cron-jobs'],
    ['get', '/api/sessions'],
    ['get', '/api/settings'],
    ['get', '/api/event-logs'],
    ['get', '/api/telegram/commands'],
    ['post', '/api/models'],
    ['post', '/api/chat'],
    ['put', '/api/settings/timezone'],
    ['delete', '/api/agents/1'],
  ];

  for (const [method, path] of ENDPOINTS) {
    test(`${method.toUpperCase()} ${path} → 401 without a session`, async () => {
      const res = await anon[method](path, { headers: JSON_ACCEPT });
      expect(res.status()).toBe(401);
      expect(await res.json()).toEqual({ error: 'unauthorized' });
    });
  }

  test('login with wrong credentials → 401, no cookie', async () => {
    const res = await anon.post('/api/login', {
      headers: JSON_ACCEPT,
      data: { user: 'admin', password: 'definitely-wrong' },
    });
    expect(res.status()).toBe(401);
    expect(res.headers()['set-cookie']).toBeUndefined();
  });

  test('a forged token is rejected', async () => {
    const res = await anon.get('/api/models', {
      headers: { ...JSON_ACCEPT, Cookie: 'dogeclaw_token=deadbeef' },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe('validation and 404 contracts', () => {
  test('POST /api/models without model_id → 400', async ({ request }) => {
    const res = await request.post('/api/models', { data: { name: await uniqueName('model') } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('model_id');
  });

  test('POST /api/agents without name → 400', async ({ request }) => {
    const res = await request.post('/api/agents', { data: { system_prompt: 'x' } });
    expect(res.status()).toBe(400);
  });

  test('POST /api/skills without name → 400', async ({ request }) => {
    const res = await request.post('/api/skills', { data: { content: 'x' } });
    expect(res.status()).toBe(400);
  });

  test('POST /api/channels without agent_id/type/name → 400', async ({ request }) => {
    const res = await request.post('/api/channels', { data: { name: await uniqueName('chan') } });
    expect(res.status()).toBe(400);
  });

  test('PUT /api/agents/:id/skills with non-array → 400', async ({ request }) => {
    const res = await request.put(`/api/agents/${MISSING_ID}/skills`, { data: { skill_ids: 'nope' } });
    expect(res.status()).toBe(400);
  });

  test('PUT /api/settings/:key without value → 400', async ({ request }) => {
    const res = await request.put('/api/settings/pw-func-setting', { data: {} });
    expect(res.status()).toBe(400);
  });

  for (const resource of ['models', 'agents', 'skills', 'channels']) {
    test(`PUT /api/${resource}/:missing → 404`, async ({ request }) => {
      const res = await request.put(`/api/${resource}/${MISSING_ID}`, { data: {} });
      expect(res.status()).toBe(404);
    });
  }

  test('GET /api/sessions/:missing → 404', async ({ request }) => {
    const res = await request.get('/api/sessions/pw-func-no-such-session');
    expect(res.status()).toBe(404);
  });

  test('DELETE /api/sessions/:missing → 404', async ({ request }) => {
    const res = await request.delete('/api/sessions/pw-func-no-such-session');
    expect(res.status()).toBe(404);
  });
});

test.describe('FK semantics and skill assignment', () => {
  let modelId, agentId, skillId;

  test.beforeAll(async ({ request }) => {
    const model = await request.post('/api/models', {
      data: { name: await uniqueName('func-model'), model_id: 'test/functional' },
    });
    modelId = (await model.json()).id;

    const agent = await request.post('/api/agents', {
      data: { name: await uniqueName('func-agent'), model_id: modelId },
    });
    agentId = (await agent.json()).id;

    const skill = await request.post('/api/skills', {
      data: { name: await uniqueName('func-skill'), content: 'do things' },
    });
    skillId = (await skill.json()).id;
  });

  test.afterAll(async ({ request }) => {
    // Idempotent — some rows are deleted by the tests themselves.
    for (const [resource, id] of [['agents', agentId], ['models', modelId], ['skills', skillId]]) {
      if (id) await request.delete(`/api/${resource}/${id}`);
    }
  });

  test('assigning skills is visible from both sides', async ({ request }) => {
    const put = await request.put(`/api/agents/${agentId}/skills`, { data: { skill_ids: [skillId] } });
    expect(put.ok()).toBeTruthy();

    const { agents } = await (await request.get('/api/agents')).json();
    expect(agents.find(a => a.id === agentId).skill_ids).toContain(skillId);

    const { skills } = await (await request.get('/api/skills')).json();
    expect(skills.find(s => s.id === skillId).agent_ids).toContain(agentId);
  });

  test('re-assigning with [] clears the link', async ({ request }) => {
    await request.put(`/api/agents/${agentId}/skills`, { data: { skill_ids: [] } });
    const { agents } = await (await request.get('/api/agents')).json();
    expect(agents.find(a => a.id === agentId).skill_ids).toEqual([]);
  });

  test('deleting a model nulls agent.model_id (ON DELETE SET NULL)', async ({ request }) => {
    await request.put(`/api/agents/${agentId}/skills`, { data: { skill_ids: [skillId] } });
    const del = await request.delete(`/api/models/${modelId}`);
    expect(del.ok()).toBeTruthy();
    modelId = null;

    const { agents } = await (await request.get('/api/agents')).json();
    const agent = agents.find(a => a.id === agentId);
    expect(agent.model_id).toBeNull();
    // Unrelated links survive the model delete.
    expect(agent.skill_ids).toContain(skillId);
  });

  test('deleting an agent cascades its channels and unlinks the skill', async ({ request }) => {
    const chan = await request.post('/api/channels', {
      data: {
        agent_id: agentId,
        type: 'telegram',
        name: await uniqueName('func-chan'),
        config: { token: 'pw-fake-token' },
      },
    });
    const channelId = (await chan.json()).id;

    const del = await request.delete(`/api/agents/${agentId}`);
    expect(del.ok()).toBeTruthy();
    agentId = null;

    const { channels } = await (await request.get('/api/channels')).json();
    expect(channels.find(c => c.id === channelId)).toBeUndefined();

    // The skill row survives; only the agent_skills link is gone.
    const { skills } = await (await request.get('/api/skills')).json();
    const skill = skills.find(s => s.id === skillId);
    expect(skill).toBeDefined();
    expect(skill.agent_ids).toEqual([]);
  });

  test('settings PUT/GET round trip', async ({ request }) => {
    const put = await request.put('/api/settings/pw-func-roundtrip', { data: { value: 'v1' } });
    expect(put.ok()).toBeTruthy();
    const settings = await (await request.get('/api/settings')).json();
    expect(settings['pw-func-roundtrip']).toBe('v1');
  });
});
