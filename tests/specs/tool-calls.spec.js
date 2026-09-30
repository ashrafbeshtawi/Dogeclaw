const { test, expect } = require('@playwright/test');
const { psql } = require('../helpers/db.js');

// Tool calls in the chat UI: one collapsible block per assistant message,
// one collapsible row per call (name + trimmed args), the trimmed result when
// a row is opened, and an eye button opening a modal with the full details.
// Covered for both paths that render them: session history (seeded via psql)
// and the live SSE stream (faked with page.route — the dev stack has no model).

const LONG_QUERY = 'pw-tool-query ' + 'x'.repeat(200);
const LONG_RESULT_TAIL = 'pw-result-tail-marker';
// The marker sits at the end of an array: JSONB reorders object keys
// (shorter first), so a separate `tail` key would be serialised up front.
const longResult = { results: [...Array.from({ length: 20 }, (_, i) => `result line ${i} `.repeat(3)), LONG_RESULT_TAIL] };

test.describe('tool calls in the chat UI', () => {
  let agentId;

  test.beforeAll(async ({ request }) => {
    const a = await request.post('/api/agents', { data: { name: 'pw-toolcalls-agent', system_prompt: '' } });
    agentId = (await a.json()).id;
  });

  test.afterAll(async ({ request }) => {
    if (agentId) await request.delete(`/api/agents/${agentId}`);
  });

  test('history: rows per call, trimmed args and result, full details in the modal', async ({ page }) => {
    const sid = `pw-toolcalls-${Date.now()}`;
    const reply = `pw-toolcalls-reply-${Date.now()}`;
    const toolCalls = [
      { name: 'web_search', args: { query: LONG_QUERY }, result: longResult },
      { name: 'fetch_page', args: { url: 'https://example.com' }, result: 'short page text' },
    ];

    psql(`
      INSERT INTO sessions (id, agent_id, agent_name, source)
      VALUES ('${sid}', ${agentId}, 'pw-toolcalls-agent', 'web');
      INSERT INTO session_messages (session_id, role, content)
      VALUES ('${sid}', 'user', 'search please');
      INSERT INTO session_messages (session_id, role, content, tool_calls)
      VALUES ('${sid}', 'assistant', '${reply}', $$${JSON.stringify(toolCalls)}$$::jsonb);
    `);

    try {
      await page.goto('/');
      await page.locator('#sessions .session-item', { hasText: reply }).click();

      const block = page.locator('.msg.assistant .tool-calls');
      await expect(block.locator('.thinking-toggle')).toHaveText('🔧 Tools (2): web_search, fetch_page');

      // Collapsed by default; one click lists the calls.
      const rows = block.locator('.tool-call');
      await expect(rows.first()).toBeHidden();
      await block.locator('.thinking-toggle').click();
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0).locator('.tool-call-name')).toHaveText('web_search');
      await expect(rows.nth(1).locator('.tool-call-name')).toHaveText('fetch_page');

      // Long args are trimmed in the row, short ones shown whole.
      const args = await rows.nth(0).locator('.tool-call-args').textContent();
      expect(args.startsWith('{"query":"pw-tool-query')).toBe(true);
      expect(args.endsWith('…')).toBe(true);
      expect(args.length).toBeLessThan(LONG_QUERY.length);
      await expect(rows.nth(1).locator('.tool-call-args')).toHaveText('{"url":"https://example.com"}');

      // Results stay hidden until the row is opened, then show trimmed.
      const body = rows.nth(0).locator('.tool-call-body');
      await expect(body).toBeHidden();
      await rows.nth(0).locator('.tool-call-toggle').click();
      await expect(body).toBeVisible();
      await expect(body).toContainText('result line 0');
      await expect(body).not.toContainText(LONG_RESULT_TAIL);
      expect((await body.textContent()).endsWith('…')).toBe(true);
      await expect(rows.nth(1).locator('.tool-call-body')).toBeHidden();

      // The eye opens the full details of that call only.
      const modal = page.locator('#toolCallModal');
      await expect(modal).toBeHidden();
      await rows.nth(0).locator('.tool-call-eye').click();
      await expect(modal).toBeVisible();
      await expect(page.locator('#toolCallModalTitle')).toHaveText('web_search');
      await expect(page.locator('#toolCallModalArgs')).toContainText(LONG_QUERY);
      await expect(page.locator('#toolCallModalResult')).toContainText(LONG_RESULT_TAIL);

      await page.keyboard.press('Escape');
      await expect(modal).toBeHidden();

      await rows.nth(1).locator('.tool-call-eye').click();
      await expect(page.locator('#toolCallModalTitle')).toHaveText('fetch_page');
      await expect(page.locator('#toolCallModalResult')).toHaveText('short page text');
      await modal.locator('.btn-cancel').click();
      await expect(modal).toBeHidden();
    } finally {
      psql(`DELETE FROM sessions WHERE id = '${sid}';`);
    }
  });

  test('history: tool output is rendered as text, never as HTML', async ({ page }) => {
    const sid = `pw-toolcalls-xss-${Date.now()}`;
    const reply = `pw-toolcalls-xss-${Date.now()}`;
    const payload = '<img src=x onerror="window.__pwXss=1">';
    const toolCalls = [{ name: 'fetch_page', args: { url: payload }, result: payload }];

    psql(`
      INSERT INTO sessions (id, agent_id, agent_name, source)
      VALUES ('${sid}', ${agentId}, 'pw-toolcalls-agent', 'web');
      INSERT INTO session_messages (session_id, role, content, tool_calls)
      VALUES ('${sid}', 'assistant', '${reply}', $$${JSON.stringify(toolCalls)}$$::jsonb);
    `);

    try {
      await page.goto('/');
      await page.locator('#sessions .session-item', { hasText: reply }).click();
      const block = page.locator('.msg.assistant .tool-calls');
      await block.locator('.thinking-toggle').click();
      await block.locator('.tool-call-toggle').click();
      await block.locator('.tool-call-eye').click();

      await expect(page.locator('#toolCallModalResult')).toHaveText(payload);
      await expect(page.locator('.tool-calls img, #toolCallModal img')).toHaveCount(0);
      expect(await page.evaluate(() => window.__pwXss)).toBeUndefined();
    } finally {
      psql(`DELETE FROM sessions WHERE id = '${sid}';`);
    }
  });

  test('live stream: every round is listed and results attach to their call', async ({ page }) => {
    const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const body = [
      sse('tool_calls', [
        { function: { name: 'web_search', arguments: { query: LONG_QUERY } } },
        { function: { name: 'web_search', arguments: { query: 'second search' } } },
      ]),
      sse('tool_result', { name: 'web_search', result: { first: true } }),
      sse('tool_result', { name: 'web_search', result: { second: true } }),
      // A second round must be added to the same block, not replace it.
      sse('tool_calls', [{ function: { name: 'fetch_page', arguments: { url: 'https://example.com' } } }]),
      sse('tool_result', { name: 'fetch_page', result: 'page text' }),
      sse('content', 'pw-live-answer'),
      sse('done', { sessionId: null }),
    ].join('');

    await page.route('**/api/chat', (route) =>
      route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body }));

    await page.goto('/');
    // loadAgents() rewrites #messages when it finishes (setup hint on a stack
    // without models) — let it land before streaming into the list.
    await expect(page.locator('#agentSelect option').first()).toBeAttached();
    await page.evaluate(() => {
      document.getElementById('input').value = 'pw-live-question';
      send();
    });

    const message = page.locator('.msg.assistant', { hasText: 'pw-live-answer' });
    await expect(message).not.toHaveClass(/streaming/);
    const block = message.locator('.tool-calls');
    await expect(block.locator('.thinking-toggle')).toHaveText('🔧 Tools (3): web_search, web_search, fetch_page');

    // Collapsed once the turn is finished.
    const rows = block.locator('.tool-call');
    await expect(rows.first()).toBeHidden();
    await block.locator('.thinking-toggle').click();
    await expect(rows).toHaveCount(3);

    // Same-named calls get their results in order.
    for (const [i, expected] of [[0, '"first": true'], [1, '"second": true'], [2, 'page text']]) {
      await rows.nth(i).locator('.tool-call-toggle').click();
      await expect(rows.nth(i).locator('.tool-call-body')).toContainText(expected);
    }

    await rows.nth(0).locator('.tool-call-eye').click();
    await expect(page.locator('#toolCallModalArgs')).toContainText(LONG_QUERY);
    await expect(page.locator('#toolCallModalResult')).toContainText('"first": true');
  });
});
