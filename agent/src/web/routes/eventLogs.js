import express from 'express';
import { adminQuery as query } from '../../db/pool.js';
import { listEventLogs, getEventLog, deleteEventLog as deleteEventLogRow, deleteAllEventLogs, deleteEventLogsOlderThan, EVENT_KINDS } from '../../db/eventLogs.js';

export function eventLogsRoutes() {
  const router = express.Router();

  // --- Event logs (cron runs) ---
  router.get('/event-logs', async (req, res) => {
    const { kind, ref_id, limit, before } = req.query;
    if (kind && !EVENT_KINDS.includes(kind)) {
      return res.status(400).json({ error: `unknown kind: ${kind}` });
    }
    try {
      const rows = await listEventLogs({ kind, refId: ref_id, limit, before });
      res.json({ logs: rows, kinds: EVENT_KINDS });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/event-logs/:id', async (req, res) => {
    try {
      const row = await getEventLog(req.params.id);
      if (!row) return res.status(404).json({ error: 'not found' });
      res.json(row);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/event-logs/:id', async (req, res) => {
    const ok = await deleteEventLogRow(req.params.id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });

  // Bulk delete: ?kind=... narrows; ?older_than_days=N prunes by age; neither
  // means wipe-all (used by the "Clear all" button).
  router.delete('/event-logs', async (req, res) => {
    const { kind, older_than_days } = req.query;
    if (kind && !EVENT_KINDS.includes(kind)) {
      return res.status(400).json({ error: `unknown kind: ${kind}` });
    }
    try {
      if (older_than_days) {
        const deleted = await deleteEventLogsOlderThan(Number(older_than_days));
        return res.json({ ok: true, deleted });
      }
      const deleted = await deleteAllEventLogs({ kind });
      res.json({ ok: true, deleted });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
