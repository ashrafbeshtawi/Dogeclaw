// Regression test for the bug where a Telegram channel kept using the
// OLD model after the agent's model_id was changed in the admin UI.
//
// The bot's message handler was closure-capturing the channel row from
// reload() time. node-telegram-bot-api's stopPolling() doesn't reliably
// halt an in-flight long poll, so the old bot could still process
// incoming messages with its stale channel — pointing at the old model.
//
// The fix introduces a #channelById map that's the single source of
// truth: handlers read the current config on every message, so an
// admin-UI model swap is reflected immediately. /api/channels/:id/runtime
// exposes the manager's live view for verification.

const { test, expect } = require('@playwright/test');
const { uniqueName } = require('../helpers/ui.js');

test.describe('telegram channel picks up agent.model_id changes live', () => {
  let modelAId, modelBId, agentId, channelId;

  test.beforeAll(async ({ request }) => {
    // Two distinct models — values don't need to correspond to real
    // providers; we only assert that the runtime view returns the
    // currently-assigned model's `model_id` string.
    const mA = await request.post('/api/models', {
      data: {
        name: await uniqueName('tg-runtime-model-A'),
        provider: 'ollama',
        base_url: 'http://nx-a.invalid:11434',
        model_id: 'pw-tg-runtime-model-A',
        api_key: null,
        think: false,
        accepts: ['text'],
      },
    });
    expect(mA.ok()).toBeTruthy();
    modelAId = (await mA.json()).id;

    const mB = await request.post('/api/models', {
      data: {
        name: await uniqueName('tg-runtime-model-B'),
        provider: 'ollama',
        base_url: 'http://nx-b.invalid:11434',
        model_id: 'pw-tg-runtime-model-B',
        api_key: null,
        think: false,
        accepts: ['text'],
      },
    });
    expect(mB.ok()).toBeTruthy();
    modelBId = (await mB.json()).id;

    // Agent starts pointing at model A.
    const a = await request.post('/api/agents', {
      data: { name: await uniqueName('tg-runtime-agent'), system_prompt: 'pw test agent' },
    });
    expect(a.ok()).toBeTruthy();
    agentId = (await a.json()).id;
    await request.put(`/api/agents/${agentId}`, { data: { model_id: modelAId } });

    // Telegram channel bound to that agent. A syntactically-valid but
    // unauthorized fake token: polling will fail with 401 in the background;
    // we don't care, we only assert the in-memory channel config.
    const c = await request.post('/api/channels', {
      data: {
        agent_id: agentId,
        type: 'telegram',
        name: await uniqueName('tg-runtime-channel'),
        config: { token: '0000000000:PW-TEST-TOKEN-not-real' },
        response_mode: 'immediate',
      },
    });
    expect(c.ok()).toBeTruthy();
    channelId = (await c.json()).id;
  });

  test.afterAll(async ({ request }) => {
    if (channelId) await request.delete(`/api/channels/${channelId}`);
    if (agentId) await request.delete(`/api/agents/${agentId}`);
    if (modelAId) await request.delete(`/api/models/${modelAId}`);
    if (modelBId) await request.delete(`/api/models/${modelBId}`);
  });

  test('runtime view reflects model A initially', async ({ request }) => {
    await expect.poll(async () => {
      const r = await request.get(`/api/channels/${channelId}/runtime`);
      if (r.status() !== 200) return null;
      return (await r.json()).model_id;
    }, { timeout: 10_000 }).toBe('pw-tg-runtime-model-A');
  });

  test('runtime view reflects model B after PUT /api/agents updates model_id', async ({ request }) => {
    // Sanity check we're starting from A
    {
      const r = await request.get(`/api/channels/${channelId}/runtime`);
      const v = await r.json();
      expect(v.model_id).toBe('pw-tg-runtime-model-A');
    }

    // Swap the agent's model to B. The PUT handler fires reloadTelegram
    // fire-and-forget, so we poll for the change rather than racing it.
    const upd = await request.put(`/api/agents/${agentId}`, { data: { model_id: modelBId } });
    expect(upd.ok()).toBeTruthy();

    await expect.poll(async () => {
      const r = await request.get(`/api/channels/${channelId}/runtime`);
      if (r.status() !== 200) return null;
      return (await r.json()).model_id;
    }, { timeout: 10_000 }).toBe('pw-tg-runtime-model-B');
  });

  test('runtime endpoint never leaks the bot token', async ({ request }) => {
    const r = await request.get(`/api/channels/${channelId}/runtime`);
    expect(r.ok()).toBeTruthy();
    const v = await r.json();
    expect(v.config).toBeDefined();
    expect(v.config.token).toBeUndefined();
    // Also make sure the token isn't smuggled in somewhere else in the payload.
    expect(JSON.stringify(v)).not.toContain('PW-TEST-TOKEN-not-real');
  });
});
