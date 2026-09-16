import express from 'express';
import { listJobs as listCronJobs, getJob as getCronJob, createJob as createCronJob, updateJob as updateCronJob, deleteJob as deleteCronJob } from '../../db/crons.js';
import { reloadCronJobs } from '../../cron/runner.js';

export function cronsRoutes() {
  const router = express.Router();

  // --- Cron jobs CRUD ---
  router.get('/cron-jobs', async (req, res) => {
    res.json({ jobs: await listCronJobs() });
  });

  router.get('/cron-jobs/:id', async (req, res) => {
    const job = await getCronJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'not found' });
    res.json(job);
  });

  router.post('/cron-jobs', async (req, res) => {
    const { agent_id, channel_id, chat_id, session_id, expression, run_at, timezone, description, prompt, enabled } = req.body;
    try {
      const job = await createCronJob({
        agentId: agent_id,
        channelId: channel_id ?? null,
        chatId: chat_id ?? null,
        sessionId: session_id ?? null,
        expression: expression ?? null,
        runAt: run_at ?? null,
        timezone,
        description,
        prompt,
        enabled,
      });
      reloadCronJobs();
      res.json(job);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.put('/cron-jobs/:id', async (req, res) => {
    const { expression, run_at, timezone, description, prompt, enabled } = req.body;
    try {
      const job = await updateCronJob(req.params.id, {
        expression,
        runAt: run_at,
        timezone,
        description,
        prompt,
        enabled,
      });
      if (!job) return res.status(404).json({ error: 'not found' });
      reloadCronJobs();
      res.json(job);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/cron-jobs/:id', async (req, res) => {
    const ok = await deleteCronJob(req.params.id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    reloadCronJobs();
    res.json({ ok: true });
  });

  return router;
}
