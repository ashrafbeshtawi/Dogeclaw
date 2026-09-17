import express from 'express';
import { listEngines as listSearchEngines, createEngine as createSearchEngine, updateEngine as updateSearchEngine, deleteEngine as deleteSearchEngine, reorderEngines as reorderSearchEngines } from '../../db/searchEngines.js';
import { PROVIDERS as SEARCH_PROVIDERS } from '../../lib/searchProviders.js';

export function searchEnginesRoutes() {
  const router = express.Router();

  // --- Search engines CRUD ---
  // Providers for the web search tools, tried in priority order with
  // failover. No reload hook needed: agent.js checks per run whether an
  // enabled engine exists and hides the search tools otherwise.
  const searchEngineFieldsFromBody = (body) => {
    const { provider, api_key, cx, enabled } = body;
    // The PROVIDERS map in lib/searchProviders.js is the single source of
    // truth for supported providers — the UI select is rendered from it too.
    if (!(provider in SEARCH_PROVIDERS)) {
      return { error: `provider must be one of: ${Object.keys(SEARCH_PROVIDERS).join(', ')}` };
    }
    if (!api_key) return { error: 'api_key required' };
    if (provider === 'google' && !cx) {
      return { error: 'cx (Programmable Search Engine ID) required for google' };
    }
    return {
      fields: {
        provider,
        apiKey: api_key,
        cx: provider === 'google' ? cx : null,
        enabled: enabled ?? true,
      },
    };
  };

  router.get('/search-engines', async (req, res) => {
    res.json({
      engines: await listSearchEngines(),
      providers: Object.keys(SEARCH_PROVIDERS),
    });
  });

  router.post('/search-engines', async (req, res) => {
    const { error, fields } = searchEngineFieldsFromBody(req.body);
    if (error) return res.status(400).json({ error });
    res.json(await createSearchEngine(fields));
  });

  // Registered before /:id so "order" isn't swallowed as an id.
  router.put('/search-engines/order', async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array required' });
    await reorderSearchEngines(ids);
    res.json({ ok: true });
  });

  router.put('/search-engines/:id', async (req, res) => {
    const { error, fields } = searchEngineFieldsFromBody(req.body);
    if (error) return res.status(400).json({ error });
    const engine = await updateSearchEngine(req.params.id, fields);
    if (!engine) return res.status(404).json({ error: 'not found' });
    res.json(engine);
  });

  router.delete('/search-engines/:id', async (req, res) => {
    const ok = await deleteSearchEngine(req.params.id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });

  return router;
}
