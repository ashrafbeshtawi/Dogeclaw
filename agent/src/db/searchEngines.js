import { adminQuery } from './pool.js';

export async function listEngines() {
  const res = await adminQuery('SELECT * FROM search_engines ORDER BY priority, id');
  return res.rows;
}

export async function listActiveEngines() {
  const res = await adminQuery('SELECT * FROM search_engines WHERE enabled ORDER BY priority, id');
  return res.rows;
}

// Gate for tool visibility: web_search/web_research only exist for the
// agent while this is true.
export async function hasActiveSearchEngine() {
  const res = await adminQuery('SELECT EXISTS (SELECT 1 FROM search_engines WHERE enabled) AS yes');
  return res.rows[0].yes;
}

export async function createEngine({ provider, apiKey, cx = null, enabled = true, priority = null }) {
  // New entries go to the end of the priority order unless told otherwise.
  const res = await adminQuery(
    `INSERT INTO search_engines (provider, api_key, cx, enabled, priority)
     VALUES ($1, $2, $3, $4,
             COALESCE($5, (SELECT COALESCE(MAX(priority), -1) + 1 FROM search_engines)))
     RETURNING *`,
    [provider, apiKey, cx, enabled, priority],
  );
  return res.rows[0];
}

export async function updateEngine(id, { provider, apiKey, cx = null, enabled = true }) {
  const res = await adminQuery(
    `UPDATE search_engines SET
       provider = $1, api_key = $2, cx = $3, enabled = $4, updated_at = NOW()
     WHERE id = $5 RETURNING *`,
    [provider, apiKey, cx, enabled, id],
  );
  return res.rows[0] || null;
}

export async function deleteEngine(id) {
  const res = await adminQuery('DELETE FROM search_engines WHERE id = $1', [id]);
  return res.rowCount > 0;
}

// UI sorting: the full id list in the desired order becomes priority 0..n-1.
export async function reorderEngines(ids) {
  for (let i = 0; i < ids.length; i++) {
    await adminQuery('UPDATE search_engines SET priority = $1, updated_at = NOW() WHERE id = $2', [i, ids[i]]);
  }
}
