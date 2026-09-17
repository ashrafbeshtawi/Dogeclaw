import express from 'express';
import { adminQuery as query } from '../../db/pool.js';
import { reloadCronJobs } from '../../cron/runner.js';
import { reloadTelegram } from '../managers.js';

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

  router.post('/agents', async (req, res) => {
    const { name, system_prompt, model_id } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const result = await query(
      'INSERT INTO agents (name, system_prompt, model_id) VALUES ($1, $2, $3) RETURNING *',
      [name, system_prompt || '', model_id || null],
    );
    res.json(result.rows[0]);
    reloadTelegram();
  });

  router.put('/agents/:id', async (req, res) => {
    const { name, system_prompt, model_id } = req.body;
    const result = await query(
      'UPDATE agents SET name = COALESCE($1, name), system_prompt = COALESCE($2, system_prompt), model_id = COALESCE($3, model_id) WHERE id = $4 RETURNING *',
      [name, system_prompt, model_id, req.params.id],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.json(result.rows[0]);
    reloadTelegram();
  });

  router.delete('/agents/:id', async (req, res) => {
    await query('DELETE FROM agents WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
    reloadTelegram();
    // Agents cascade to cron_jobs via FK; refresh the runner so it drops them.
    reloadCronJobs();
  });

  return router;
}
