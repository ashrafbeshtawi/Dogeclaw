// Regression test for the bug where /api/chat dropped the user message
// when agent.run threw. The fix appends the user row to session_messages
// BEFORE calling agent.run, so an LLM/network failure still leaves the
// user's input in session history.

const { test, expect } = require('@playwright/test');

test.describe('user message persistence when the LLM call fails', () => {
  let modelId;
  let agentId;

  test.beforeAll(async ({ request }) => {
    // Bogus base_url — fetch will fail with ENOTFOUND/ECONNREFUSED inside
    // chatOllama, agent.run propagates the error.
    const m = await request.post('/api/models', {
      data: {
        name: `pw-failing-model-${Date.now()}`,
        provider: 'ollama',
        base_url: 'http://no-such-host-pw.invalid:11434',
        model_id: 'pw-irrelevant',
        api_key: null,
        think: false,
        accepts: ['text'],
      },
    });
    expect(m.ok()).toBeTruthy();
    modelId = (await m.json()).id;

    const a = await request.post('/api/agents', {
      data: { name: `pw-failing-agent-${Date.now()}`, system_prompt: 'pw test agent' },
    });
    expect(a.ok()).toBeTruthy();
    agentId = (await a.json()).id;

    // The seeder doesn't help here — we need the model assigned to THIS agent.
    const upd = await request.put(`/api/agents/${agentId}`, { data: { model_id: modelId } });
    expect(upd.ok()).toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    if (agentId) await request.delete(`/api/agents/${agentId}`);
    if (modelId) await request.delete(`/api/models/${modelId}`);
  });

  test('user row is written even when agent.run throws', async ({ request }) => {
    const sid = `pw-fail-${Date.now()}`;
    const marker = `pw-marker-${Date.now()}`;

    try {
      // SSE endpoint — fetch resolves once headers arrive; consume the body
      // so the server-side handler finishes (and the catch path runs) before
      // we query the session.
      const res = await request.post('/api/chat', {
        data: { message: marker, sessionId: sid, agentId },
      });
      expect(res.status()).toBe(200);
      const body = await res.text();
      // The error event should have fired in the SSE stream.
      expect(body).toContain('event: error');

      const detail = await (await request.get(`/api/sessions/${sid}`)).json();
      const userMessages = (detail.messages || []).filter(m => m.role === 'user');
      expect(userMessages.length).toBe(1);
      expect(userMessages[0].content).toContain(marker);

      // No assistant reply was produced — the user row stands alone.
      const assistantMessages = (detail.messages || []).filter(m => m.role === 'assistant');
      expect(assistantMessages.length).toBe(0);
    } finally {
      await request.delete(`/api/sessions/${sid}`);
    }
  });
});
