import { adminQuery } from './pool.js';

export async function getSetting(key, fallback = null) {
  const res = await adminQuery('SELECT value FROM settings WHERE key = $1', [key]);
  if (res.rowCount === 0) return fallback;
  return res.rows[0].value;
}

export async function setSetting(key, value) {
  await adminQuery(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(value)],
  );
}

export async function getAllSettings() {
  const res = await adminQuery('SELECT key, value FROM settings ORDER BY key');
  return Object.fromEntries(res.rows.map(r => [r.key, r.value]));
}

export async function getTimezone() {
  return (await getSetting('timezone', 'UTC')) || 'UTC';
}
