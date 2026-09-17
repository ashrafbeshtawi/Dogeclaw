import express from 'express';
import { adminQuery as query } from '../../db/pool.js';
import { reloadCronJobs } from '../../cron/runner.js';
import { BOT_COMMANDS } from '../../channels/telegram.js';
import { getTelegramManager } from '../managers.js';

export function channelsRoutes() {
  const router = express.Router();

  // --- Channels CRUD ---
  router.get('/channels', async (req, res) => {
    const result = await query(`
      SELECT c.*, a.name as agent_name
      FROM channels c JOIN agents a ON c.agent_id = a.id
      ORDER BY c.id
    `);
    res.json({ channels: result.rows });
  });

  // The canonical slash-command list the manager registers with Telegram
  // (`bot.setMyCommands`) on every bot start. Also used by the /start
  // greeting so the inline text matches the `/` menu in the client.
  router.get('/telegram/commands', (req, res) => {
    res.json({ commands: BOT_COMMANDS });
  });

  // Returns the live in-memory view the running telegram manager has for a
  // channel — useful for diagnosing "I changed the model but the bot still
  // uses the old one" issues, and exercised by the regression spec.
  // Auth-gated like the rest of /api.
  router.get('/channels/:id/runtime', (req, res) => {
    if (!getTelegramManager()) return res.status(503).json({ error: 'telegram manager not running' });
    const view = getTelegramManager().getChannelView(req.params.id);
    if (!view) return res.status(404).json({ error: 'no live channel data for this id' });
    // Don't leak secrets: the bot token and the model api key ride along in
    // the manager's joined row.
    const { token, api_key, ...safeView } = view;
    res.json(safeView);
  });

  router.post('/channels', async (req, res) => {
    const { agent_id, type, name, token, allowed_users, response_mode, response_interval } = req.body;
    if (!agent_id || !type || !name) return res.status(400).json({ error: 'agent_id, type, and name required' });
    if (type === 'telegram' && !token) return res.status(400).json({ error: 'token required for telegram channels' });
    // webhook_id is minted by the DB default at INSERT and never changes —
    // the telegram manager's #startBot registers the route and points
    // Telegram's webhook at it during the reload below.
    const result = await query(
      `INSERT INTO channels (agent_id, type, name, token, allowed_users, response_mode, response_interval)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [agent_id, type, name, token, allowed_users || [], response_mode || 'immediate', response_interval],
    );
    res.json(result.rows[0]);
    if (getTelegramManager()) getTelegramManager().reload().catch(e => console.error('[telegram] reload failed:', e.message));
  });

  router.put('/channels/:id', async (req, res) => {
    const { agent_id, name, token, allowed_users, response_mode, response_interval, enabled } = req.body;
    const result = await query(
      `UPDATE channels SET
        agent_id = COALESCE($1, agent_id), name = COALESCE($2, name),
        token = COALESCE($3, token), allowed_users = COALESCE($4, allowed_users),
        response_mode = COALESCE($5, response_mode),
        response_interval = COALESCE($6, response_interval), enabled = COALESCE($7, enabled)
      WHERE id = $8 RETURNING *`,
      [agent_id, name, token, allowed_users, response_mode, response_interval, enabled, req.params.id],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.json(result.rows[0]);
    if (getTelegramManager()) getTelegramManager().reload().catch(e => console.error('[telegram] reload failed:', e.message));
  });

  router.delete('/channels/:id', async (req, res) => {
    // Get channel info before deleting (to remove webhook)
    try {
      const ch = await query('SELECT * FROM channels WHERE id = $1', [req.params.id]);
      const channel = ch.rows[0];
      if (channel?.type === 'telegram' && channel.token) {
        fetch(`https://api.telegram.org/bot${channel.token}/deleteWebhook`)
          .then(r => r.json()).then(d => console.log(`[telegram] Webhook deleted for ${channel.name}:`, d.ok ? 'ok' : d.description))
          .catch(e => console.error(`[telegram] Failed to delete webhook:`, e.message));
      }
    } catch {}
    await query('DELETE FROM channels WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
    if (getTelegramManager()) getTelegramManager().reload().catch(e => console.error('[telegram] reload failed:', e.message));
    // Channels cascade to cron_jobs via FK; refresh the runner so it drops them.
    reloadCronJobs();
  });

  return router;
}
