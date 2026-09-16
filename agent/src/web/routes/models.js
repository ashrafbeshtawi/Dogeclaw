import express from 'express';
import { adminQuery as query } from '../../db/pool.js';
import { reloadTelegram } from '../managers.js';

export function modelsRoutes() {
  const router = express.Router();

  // --- Models CRUD ---
  router.get('/models', async (req, res) => {
    const result = await query('SELECT * FROM models ORDER BY id');
    res.json({ models: result.rows });
  });

  router.post('/models', async (req, res) => {
    const { name, provider, base_url, model_id, api_key, think, accepts } = req.body;
    if (!name || !model_id) return res.status(400).json({ error: 'name and model_id required' });
    const result = await query(
      'INSERT INTO models (name, provider, base_url, model_id, api_key, think, accepts) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [name, provider || 'ollama', base_url || 'http://ollama:11434', model_id, api_key || null, think || false, JSON.stringify(accepts || ['text'])],
    );
    res.json(result.rows[0]);
    reloadTelegram();
  });

  router.put('/models/:id', async (req, res) => {
    const { name, provider, base_url, model_id, api_key, think, accepts } = req.body;
    const result = await query(
      `UPDATE models SET name = COALESCE($1, name), provider = COALESCE($2, provider),
       base_url = COALESCE($3, base_url), model_id = COALESCE($4, model_id),
       api_key = COALESCE($5, api_key), think = COALESCE($6, think), accepts = COALESCE($7, accepts)
       WHERE id = $8 RETURNING *`,
      [name, provider, base_url, model_id, api_key, think, accepts ? JSON.stringify(accepts) : null, req.params.id],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.json(result.rows[0]);
    reloadTelegram();
  });

  router.post('/models/test', async (req, res) => {
    const { provider, base_url, model_id, api_key } = req.body;
    try {
      if (provider === 'openrouter') {
        const r = await fetch(`${base_url}/api/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api_key}` },
          body: JSON.stringify({ model: model_id, messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }], max_tokens: 10 }),
        });
        if (!r.ok) { const t = await r.text(); return res.json({ ok: false, error: `${r.status}: ${t.slice(0, 200)}` }); }
        const data = await r.json();
        res.json({ ok: true, reply: data.choices?.[0]?.message?.content || '(empty)' });
      } else if (provider === 'google') {
        const url = `${base_url || 'https://generativelanguage.googleapis.com'}/v1beta/models/${model_id}:generateContent?key=${api_key}`;
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Say "ok" and nothing else.' }] }] }),
        });
        if (!r.ok) { const t = await r.text(); return res.json({ ok: false, error: `${r.status}: ${t.slice(0, 200)}` }); }
        const data = await r.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '(empty)';
        res.json({ ok: true, reply: text });
      } else {
        const r = await fetch(`${base_url || 'http://ollama:11434'}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: model_id, messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }], stream: false, think: false }),
        });
        if (!r.ok) { const t = await r.text(); return res.json({ ok: false, error: `${r.status}: ${t.slice(0, 200)}` }); }
        const data = await r.json();
        res.json({ ok: true, reply: data.message?.content || '(empty)' });
      }
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  router.delete('/models/:id', async (req, res) => {
    await query('DELETE FROM models WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
    reloadTelegram();
  });

  return router;
}
