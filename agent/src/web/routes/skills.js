import express from 'express';
import { adminQuery as query } from '../../db/pool.js';

export function skillsRoutes() {
  const router = express.Router();

  // --- Skills CRUD ---
  router.get('/skills', async (req, res) => {
    const result = await query(`
      SELECT s.*, COALESCE(
        (SELECT json_agg(agent_id) FROM agent_skills WHERE skill_id = s.id),
        '[]'::json
      ) AS agent_ids
      FROM skills s ORDER BY s.id
    `);
    res.json({ skills: result.rows });
  });

  router.post('/skills', async (req, res) => {
    const { name, description, content, agent_ids } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const result = await query(
      'INSERT INTO skills (name, description, content) VALUES ($1, $2, $3) RETURNING *',
      [name, description || '', content || ''],
    );
    const skill = result.rows[0];
    if (Array.isArray(agent_ids) && agent_ids.length) {
      for (const aid of agent_ids) {
        await query('INSERT INTO agent_skills (skill_id, agent_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [skill.id, aid]);
      }
    }
    res.json(skill);
  });

  router.put('/skills/:id', async (req, res) => {
    const { name, description, content, agent_ids } = req.body;
    const result = await query(
      'UPDATE skills SET name = COALESCE($1, name), description = COALESCE($2, description), content = COALESCE($3, content) WHERE id = $4 RETURNING *',
      [name, description, content, req.params.id],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'not found' });
    if (Array.isArray(agent_ids)) {
      await query('DELETE FROM agent_skills WHERE skill_id = $1', [req.params.id]);
      for (const aid of agent_ids) {
        await query('INSERT INTO agent_skills (skill_id, agent_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, aid]);
      }
    }
    res.json(result.rows[0]);
  });

  router.delete('/skills/:id', async (req, res) => {
    await query('DELETE FROM skills WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  });

  // Manage skill assignment from agent perspective
  router.put('/agents/:id/skills', async (req, res) => {
    const { skill_ids } = req.body;
    if (!Array.isArray(skill_ids)) return res.status(400).json({ error: 'skill_ids array required' });
    await query('DELETE FROM agent_skills WHERE agent_id = $1', [req.params.id]);
    for (const sid of skill_ids) {
      await query('INSERT INTO agent_skills (agent_id, skill_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, sid]);
    }
    res.json({ ok: true });
  });

  return router;
}
