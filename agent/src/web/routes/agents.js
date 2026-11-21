import express from 'express';
import { adminQuery as query } from '../../db/pool.js';
import { reloadTelegram } from '../managers.js';

// Mounted under /api behind authMiddleware in server.js; no per-route guards needed.
export function agentsRoutes() {
  const router = express.Router();

  // --- Agents CRUD ---
  router.get('/agents', async (req, res) => {
    const result = await query(
      `SELECT a.*, m.name as model_name, m.model_id as ollama_model, m.think, m.accepts,
        COALESCE((SELECT json_agg(skill_id) FROM agent_skills WHERE agent_id = a.id), '[]'::json) AS skill_ids
       FROM agents a LEFT JOIN models m ON a.model_id = m.id ORDER BY a.id`);
    res.json({ agents: result.rows });
  });

  // is_admin grants the admin ("god") tool set — see tools/admin.js. Only
  // this operator-facing API can set it; the admin tools never do.
  router.post('/agents', async (req, res) => {
    const { name, system_prompt, model_id, is_admin } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const result = await query(
      'INSERT INTO agents (name, system_prompt, model_id, is_admin) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, system_prompt || '', model_id || null, is_admin === true],
    );
    res.json(result.rows[0]);
    reloadTelegram();
  });

  router.put('/agents/:id', async (req, res) => {
    const { name, system_prompt, model_id, is_admin } = req.body;
    const result = await query(
      'UPDATE agents SET name = COALESCE($1, name), system_prompt = COALESCE($2, system_prompt), model_id = COALESCE($3, model_id), is_admin = COALESCE($4, is_admin) WHERE id = $5 RETURNING *',
      [name, system_prompt, model_id, typeof is_admin === 'boolean' ? is_admin : null, req.params.id],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.json(result.rows[0]);
    reloadTelegram();
  });

  router.delete('/agents/:id', async (req, res) => {
    await query('DELETE FROM agents WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
    reloadTelegram();
  });

  return router;
}
