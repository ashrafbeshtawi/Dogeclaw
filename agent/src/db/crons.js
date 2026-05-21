import cron from 'node-cron';
import { adminQuery } from './pool.js';

function validateSchedule({ expression, runAt }) {
  const hasExpr = expression != null && expression !== '';
  const hasRunAt = runAt != null && runAt !== '';
  if (hasExpr === hasRunAt) return 'exactly one of expression or run_at is required';
  if (hasExpr && !cron.validate(expression)) return `invalid cron expression: ${expression}`;
  if (hasRunAt && isNaN(new Date(runAt).getTime())) return `invalid run_at: ${runAt}`;
  return null;
}

function validateTarget({ channelId, chatId, sessionId }) {
  const hasChat = chatId != null && chatId !== '';
  const hasSession = sessionId != null && sessionId !== '';
  if (hasChat === hasSession) return 'exactly one of (channel_id+chat_id) or session_id is required';
  if (hasChat && (channelId == null || channelId === '')) return 'channel_id is required when chat_id is set';
  return null;
}

export async function listJobs() {
  const res = await adminQuery(
    `SELECT j.*, a.name AS agent_name, c.name AS channel_name
       FROM cron_jobs j
       LEFT JOIN agents   a ON j.agent_id   = a.id
       LEFT JOIN channels c ON j.channel_id = c.id
      ORDER BY j.id DESC`,
  );
  return res.rows;
}

export async function listEnabledJobs() {
  const res = await adminQuery(`SELECT * FROM cron_jobs WHERE enabled ORDER BY id`);
  return res.rows;
}

export async function getJob(id) {
  const res = await adminQuery(`SELECT * FROM cron_jobs WHERE id = $1`, [id]);
  return res.rows[0] || null;
}

export async function createJob(input) {
  const err = validateSchedule(input) || validateTarget(input);
  if (err) throw new Error(err);
  if (!input.agentId) throw new Error('agent_id is required');
  if (!input.prompt) throw new Error('prompt is required');

  const res = await adminQuery(
    `INSERT INTO cron_jobs
       (agent_id, channel_id, chat_id, session_id, expression, run_at,
        timezone, description, prompt, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      input.agentId,
      input.channelId || null,
      input.chatId != null && input.chatId !== '' ? String(input.chatId) : null,
      input.sessionId != null && input.sessionId !== '' ? input.sessionId : null,
      input.expression || null,
      input.runAt || null,
      input.timezone || 'UTC',
      input.description || '',
      input.prompt,
      input.enabled !== false,
    ],
  );
  return res.rows[0];
}

export async function updateJob(id, patch) {
  const current = await getJob(id);
  if (!current) return null;

  const merged = {
    expression: patch.expression !== undefined ? patch.expression : current.expression,
    runAt:      patch.runAt      !== undefined ? patch.runAt      : current.run_at,
  };
  const err = validateSchedule(merged);
  if (err) throw new Error(err);

  const sets = [];
  const values = [];
  let i = 1;
  for (const [col, val] of [
    ['expression',  patch.expression],
    ['run_at',      patch.runAt],
    ['timezone',    patch.timezone],
    ['description', patch.description],
    ['prompt',      patch.prompt],
    ['enabled',     patch.enabled],
  ]) {
    if (val !== undefined) {
      sets.push(`${col} = $${i++}`);
      values.push(val);
    }
  }
  if (!sets.length) return current;
  sets.push(`updated_at = NOW()`);
  values.push(id);
  const res = await adminQuery(
    `UPDATE cron_jobs SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    values,
  );
  return res.rows[0] || null;
}

export async function deleteJob(id) {
  const res = await adminQuery(`DELETE FROM cron_jobs WHERE id = $1`, [id]);
  return res.rowCount > 0;
}

export async function recordRun(id, { status, error }) {
  await adminQuery(
    `UPDATE cron_jobs
        SET last_run_at = NOW(),
            last_status = $1,
            last_error  = $2,
            run_count   = run_count + 1,
            updated_at  = NOW()
      WHERE id = $3`,
    [status, error || null, id],
  );
}

export async function disableJob(id) {
  await adminQuery(`UPDATE cron_jobs SET enabled = false, updated_at = NOW() WHERE id = $1`, [id]);
}

export async function findDueOneShots() {
  const res = await adminQuery(
    `SELECT * FROM cron_jobs
      WHERE enabled = true AND run_at IS NOT NULL AND run_at <= NOW()`,
  );
  return res.rows;
}
