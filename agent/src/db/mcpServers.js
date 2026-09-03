import { adminQuery } from './pool.js';

export async function listServers() {
  const res = await adminQuery(`
    SELECT s.*, COALESCE(
      (SELECT json_agg(agent_id) FROM agent_mcp_servers WHERE server_id = s.id),
      '[]'::json
    ) AS agent_ids
    FROM mcp_servers s ORDER BY s.id
  `);
  return res.rows;
}

export async function listEnabledServers() {
  const res = await adminQuery('SELECT * FROM mcp_servers WHERE enabled ORDER BY id');
  return res.rows;
}

// Names of the enabled servers assigned to this agent — the agent's MCP
// visibility set. Runs on the admin connection: the restricted dogeclaw
// role has no access to MCP tables by design.
export async function getAgentMcpServerNames(agentId) {
  const res = await adminQuery(`
    SELECT s.name FROM mcp_servers s
    JOIN agent_mcp_servers a ON a.server_id = s.id
    WHERE a.agent_id = $1 AND s.enabled
  `, [agentId]);
  return res.rows.map(r => r.name);
}

export async function setServerAgents(serverId, agentIds) {
  await adminQuery('DELETE FROM agent_mcp_servers WHERE server_id = $1', [serverId]);
  for (const aid of agentIds) {
    await adminQuery(
      'INSERT INTO agent_mcp_servers (server_id, agent_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [serverId, aid],
    );
  }
}

export async function createServer({
  name, description = '', transport = 'stdio', command = null, args = [], env = {},
  url = null, headers = {}, enabled = true,
}) {
  const res = await adminQuery(
    `INSERT INTO mcp_servers (name, description, transport, command, args, env, url, headers, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [name, description, transport, command, JSON.stringify(args), JSON.stringify(env), url,
     JSON.stringify(headers), enabled],
  );
  return res.rows[0];
}

// Full-row update: the admin UI always loads the current row into the edit
// form, so every column is written back.
export async function updateServer(id, {
  name, description = '', transport = 'stdio', command = null, args = [], env = {},
  url = null, headers = {}, enabled = true,
}) {
  const res = await adminQuery(
    `UPDATE mcp_servers SET
       name = $1, description = $2, transport = $3, command = $4, args = $5, env = $6,
       url = $7, headers = $8, enabled = $9, updated_at = NOW()
     WHERE id = $10 RETURNING *`,
    [name, description, transport, command, JSON.stringify(args), JSON.stringify(env), url,
     JSON.stringify(headers), enabled, id],
  );
  return res.rows[0] || null;
}

export async function deleteServer(id) {
  const res = await adminQuery('DELETE FROM mcp_servers WHERE id = $1', [id]);
  return res.rowCount > 0;
}
