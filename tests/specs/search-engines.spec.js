const { test, expect } = require('@playwright/test');
const { openAdminTab } = require('../helpers/ui.js');

// search_engines has no name column, so the pw-* global cleanup can't purge
// leftovers — tests delete what they create in finally, and beforeEach
// sweeps any pw-* rows a previously failed run left behind (a leftover with
// the same api_key would otherwise break row lookups).

test.describe('search engines', () => {
  test.beforeEach(async ({ page, request }) => {
    page.on('dialog', d => d.accept());
    const list = await (await request.get('/api/search-engines')).json();
    for (const e of list.engines.filter(e => e.api_key.startsWith('pw-'))) {
      await request.delete(`/api/search-engines/${e.id}`);
    }
  });

  test('api: create, list, update, delete a brave engine', async ({ request }) => {
    const created = await request.post('/api/search-engines', {
      data: { provider: 'brave', api_key: 'pw-brave-key' },
    });
    expect(created.ok()).toBeTruthy();
    const engine = await created.json();
    expect(engine.provider).toBe('brave');
    expect(engine.cx).toBeNull();
    expect(engine.enabled).toBe(true);

    try {
      const list = await (await request.get('/api/search-engines')).json();
      expect(list.engines.some(e => e.id === engine.id)).toBeTruthy();
      // The UI renders the provider select from this — single source of truth.
      expect(list.providers).toEqual(['google', 'brave']);

      const updated = await request.put(`/api/search-engines/${engine.id}`, {
        data: { provider: 'brave', api_key: 'pw-brave-key-2', enabled: false },
      });
      expect(updated.ok()).toBeTruthy();
      const row = await updated.json();
      expect(row.api_key).toBe('pw-brave-key-2');
      expect(row.enabled).toBe(false);
    } finally {
      const del = await request.delete(`/api/search-engines/${engine.id}`);
      expect(del.ok()).toBeTruthy();
    }
  });

  test('api: validation — provider, api_key, google needs cx', async ({ request }) => {
    const badProvider = await request.post('/api/search-engines', {
      data: { provider: 'bing', api_key: 'x' },
    });
    expect(badProvider.status()).toBe(400);

    const noKey = await request.post('/api/search-engines', {
      data: { provider: 'brave' },
    });
    expect(noKey.status()).toBe(400);

    const googleNoCx = await request.post('/api/search-engines', {
      data: { provider: 'google', api_key: 'x' },
    });
    expect(googleNoCx.status()).toBe(400);
    expect((await googleNoCx.json()).error).toMatch(/cx/);

    const googleOk = await request.post('/api/search-engines', {
      data: { provider: 'google', api_key: 'pw-g-key', cx: 'pw-cx' },
    });
    expect(googleOk.ok()).toBeTruthy();
    await request.delete(`/api/search-engines/${(await googleOk.json()).id}`);
  });

  test('api: new engines append to the priority order; reorder flips it', async ({ request }) => {
    const a = await (await request.post('/api/search-engines', {
      data: { provider: 'brave', api_key: 'pw-order-a' },
    })).json();
    const b = await (await request.post('/api/search-engines', {
      data: { provider: 'google', api_key: 'pw-order-b', cx: 'pw-cx' },
    })).json();

    try {
      const order = async () => {
        const list = await (await request.get('/api/search-engines')).json();
        return list.engines.filter(e => [a.id, b.id].includes(e.id)).map(e => e.id);
      };
      expect(await order()).toEqual([a.id, b.id]);

      const reorder = await request.put('/api/search-engines/order', { data: { ids: [b.id, a.id] } });
      expect(reorder.ok()).toBeTruthy();
      expect(await order()).toEqual([b.id, a.id]);

      const empty = await request.put('/api/search-engines/order', { data: { ids: [] } });
      expect(empty.status()).toBe(400);
    } finally {
      await request.delete(`/api/search-engines/${a.id}`);
      await request.delete(`/api/search-engines/${b.id}`);
    }
  });

  test('ui: create via modal, provider toggles cx field, reorder, delete', async ({ page, request }) => {
    let braveId, googleId;
    try {
      await openAdminTab(page, 'search');

      // Create a brave engine — cx field hidden for brave
      await page.click('button:has-text("+ New Engine")');
      await expect(page.locator('#searchEngineModal')).toHaveClass(/open/);
      await page.selectOption('#searchEngineProvider', 'brave');
      await expect(page.locator('#searchEngineCxField')).toBeHidden();
      await page.fill('#searchEngineKey', 'pw-ui-brave-key');
      await page.click('#searchEngineModal .btn-save');
      await expect(page.locator('#searchEngineModal')).not.toHaveClass(/open/);

      const braveRow = page.locator('#searchEnginesTable tr', { hasText: 'brave' });
      await expect(braveRow).toContainText('pw-u…-key'); // masked key
      await expect(braveRow.locator('.badge-on')).toHaveText('on');

      // Create a google engine — cx field visible and required
      await page.click('button:has-text("+ New Engine")');
      await page.selectOption('#searchEngineProvider', 'google');
      await expect(page.locator('#searchEngineCxField')).toBeVisible();
      await page.fill('#searchEngineKey', 'pw-ui-google-key');
      await page.fill('#searchEngineCx', 'pw-ui-cx');
      await page.click('#searchEngineModal .btn-save');

      // The modal save POSTs then reloads — poll the API until both rows
      // have landed instead of racing the save with a one-shot GET.
      await expect.poll(async () => {
        const list = await (await request.get('/api/search-engines')).json();
        braveId = list.engines.find(e => e.api_key === 'pw-ui-brave-key')?.id;
        googleId = list.engines.find(e => e.api_key === 'pw-ui-google-key')?.id;
        return Boolean(braveId && googleId);
      }).toBe(true);

      // Reorder: move google up one — order must flip and persist
      await page.locator('#searchEnginesTable tr', { hasText: 'google' }).locator('button:has-text("↑")').click();
      await expect.poll(async () => {
        const l = await (await request.get('/api/search-engines')).json();
        const ours = l.engines.filter(e => [braveId, googleId].includes(e.id));
        return ours.map(e => e.provider).join(',');
      }).toBe('google,brave');

      // Delete both via UI
      for (const provider of ['google', 'brave']) {
        await page.locator('#searchEnginesTable tr', { hasText: provider }).locator('button.danger').click();
        await expect(page.locator('#searchEnginesTable tr', { hasText: provider })).toHaveCount(0);
      }
      braveId = googleId = null;
    } finally {
      if (braveId) await request.delete(`/api/search-engines/${braveId}`);
      if (googleId) await request.delete(`/api/search-engines/${googleId}`);
    }
  });
});
