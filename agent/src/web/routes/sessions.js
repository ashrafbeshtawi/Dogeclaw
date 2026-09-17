import express from 'express';
import { adminQuery as query } from '../../db/pool.js';
import { loadSession, listSessions, deleteSession } from '../../db/sessions.js';
import { reloadCronJobs } from '../../cron/runner.js';

export function sessionsRoutes() {
  const router = express.Router();

  // --- Sessions ---
  router.get('/sessions', async (req, res) => {
    try {
      const sessions = await listSessions();
      res.json({ sessions });
    } catch { res.json({ sessions: [] }); }
  });

  router.get('/sessions/:id', async (req, res) => {
    try {
      const data = await loadSession(req.params.id);
      if (!data.agentId && !data.messages.length) return res.status(404).json({ error: 'not found' });
      res.json(data);
    } catch { res.status(404).json({ error: 'not found' }); }
  });

  router.get('/sessions/:id/crons', async (req, res) => {
    try {
      const r = await query(
        `SELECT id, description, expression, run_at, prompt, enabled
           FROM cron_jobs WHERE session_id = $1 ORDER BY id`,
        [req.params.id],
      );
      res.json({ jobs: r.rows });
    } catch { res.json({ jobs: [] }); }
  });

  router.delete('/sessions/:id', async (req, res) => {
    const ok = await deleteSession(req.params.id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    // Crons with session_id = $1 are cascaded by the FK; refresh the runner.
    reloadCronJobs();
    res.json({ ok: true });
  });

  return router;
}
