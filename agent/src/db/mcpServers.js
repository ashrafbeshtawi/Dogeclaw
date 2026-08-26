import { adminQuery } from './pool.js';

export async function listServers() {
  const res = await adminQuery('SELECT * FROM mcp_servers ORDER BY id');
  return res.rows;
}

export async function listEnabledServers() {
  const res = await adminQuery('SELECT * FROM mcp_servers WHERE enabled ORDER BY id');
  return res.rows;
}

export async function createServer({ name, command, args = [], env = {}, allowedTools = [], enabled = true }) {
  const res = await adminQuery(
    `INSERT INTO mcp_servers (name, command, args, env, allowed_tools, enabled)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [name, command, JSON.stringify(args), JSON.stringify(env),
     allowedTools == null ? null : JSON.stringify(allowedTools), enabled],
  );
  return res.rows[0];
}

// Full-row update: the admin UI always loads the current row into the edit
// form, so every column is written back. allowed_tools NULL ("all tools")
// stays expressible — a COALESCE-style partial update couldn't set it.
export async function updateServer(id, { name, command, args = [], env = {}, allowedTools = [], enabled = true }) {
  const res = await adminQuery(
    `UPDATE mcp_servers SET
       name = $1, command = $2, args = $3, env = $4,
       allowed_tools = $5, enabled = $6, updated_at = NOW()
     WHERE id = $7 RETURNING *`,
    [name, command, JSON.stringify(args), JSON.stringify(env),
     allowedTools == null ? null : JSON.stringify(allowedTools), enabled, id],
  );
  return res.rows[0] || null;
}

export async function deleteServer(id) {
  const res = await adminQuery('DELETE FROM mcp_servers WHERE id = $1', [id]);
  return res.rowCount > 0;
}
