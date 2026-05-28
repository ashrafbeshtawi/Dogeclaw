import { adminQuery } from './pool.js';

export const EVENT_KINDS = ['cron_run', 'audio_transcription'];

export async function insertEventLog({ kind, refId, status, input, output, error, durationMs, meta }) {
  const res = await adminQuery(
    `INSERT INTO event_logs (kind, ref_id, status, input, output, error, duration_ms, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      kind,
      refId != null ? String(refId) : null,
      status,
      input ?? null,
      output ?? null,
      error ?? null,
      Number.isFinite(durationMs) ? Math.round(durationMs) : null,
      JSON.stringify(meta || {}),
    ],
  );
  return res.rows[0];
}

export async function listEventLogs({ kind, refId, limit = 100, before } = {}) {
  const where = [];
  const params = [];
  let i = 1;
  if (kind) { where.push(`kind = $${i++}`); params.push(kind); }
  if (refId) { where.push(`ref_id = $${i++}`); params.push(String(refId)); }
  if (before) { where.push(`created_at < $${i++}`); params.push(before); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500));
  const res = await adminQuery(
    `SELECT * FROM event_logs ${clause} ORDER BY created_at DESC, id DESC LIMIT $${i}`,
    params,
  );
  return res.rows;
}

export async function getEventLog(id) {
  const res = await adminQuery(`SELECT * FROM event_logs WHERE id = $1`, [id]);
  return res.rows[0] || null;
}

export async function deleteEventLog(id) {
  const res = await adminQuery(`DELETE FROM event_logs WHERE id = $1`, [id]);
  return res.rowCount > 0;
}

export async function deleteAllEventLogs({ kind } = {}) {
  if (kind) {
    const res = await adminQuery(`DELETE FROM event_logs WHERE kind = $1`, [kind]);
    return res.rowCount;
  }
  const res = await adminQuery(`DELETE FROM event_logs`);
  return res.rowCount;
}

export async function deleteEventLogsOlderThan(days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const res = await adminQuery(
    `DELETE FROM event_logs WHERE created_at < NOW() - ($1 || ' days')::interval`,
    [String(n)],
  );
  return res.rowCount;
}
