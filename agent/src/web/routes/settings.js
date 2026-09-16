import express from 'express';
import { reloadCronJobs } from '../../cron/runner.js';
import { getAllSettings, setSetting } from '../../db/settings.js';

export function settingsRoutes() {
  const router = express.Router();

  // --- Settings ---
  router.get('/settings', async (req, res) => {
    res.json(await getAllSettings());
  });

  router.put('/settings/:key', async (req, res) => {
    const { value } = req.body;
    if (value === undefined) return res.status(400).json({ error: 'value required' });
    await setSetting(req.params.key, value);
    // Timezone changes affect cron scheduling — reload to pick up the new default.
    if (req.params.key === 'timezone') reloadCronJobs();
    res.json({ ok: true });
  });

  return router;
}
