import express from 'express';
import { getAllSettings, setSetting } from '../../db/settings.js';

// Mounted under /api behind authMiddleware in server.js; no per-route guards needed.
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
    res.json({ ok: true });
  });

  return router;
}
