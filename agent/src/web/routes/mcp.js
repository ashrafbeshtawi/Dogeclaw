import express from 'express';
import { listServers as listMcpServers, createServer as createMcpServer, updateServer as updateMcpServer, deleteServer as deleteMcpServer, setServerAgents as setMcpServerAgents } from '../../db/mcpServers.js';
import { getMcpManager } from '../managers.js';

export function mcpRoutes() {
  const router = express.Router();

  // --- MCP servers CRUD ---
  // Changes take effect immediately: every write reloads the MCP manager,
  // which reconnects servers and re-registers their tools.
  const reloadMcp = () => {
    const manager = getMcpManager();
    if (manager) manager.reload().catch(e => console.error('[mcp] reload failed:', e.message));
  };
  const MCP_NAME_RE = /^[a-zA-Z0-9_-]+$/;

  router.get('/mcp', async (req, res) => {
    res.json({ servers: await listMcpServers() });
  });

  // Shared validate/normalize for POST and PUT. Returns {error} or the
  // normalized field set for the db layer.
  const mcpFieldsFromBody = (body) => {
    const { name, description, transport, command, args, env, url, headers, enabled } = body;
    const tr = transport || 'stdio';
    if (!name) return { error: 'name required' };
    if (!MCP_NAME_RE.test(name)) {
      return { error: 'name must match [a-zA-Z0-9_-]+ (it becomes the tool prefix)' };
    }
    if (!['stdio', 'http'].includes(tr)) return { error: 'transport must be stdio or http' };
    if (tr === 'stdio' && !command) return { error: 'command required for stdio transport' };
    if (tr === 'http') {
      if (!url) return { error: 'url required for http transport' };
      try { new URL(url); } catch { return { error: 'url is not a valid URL' }; }
    }
    return {
      fields: {
        name,
        description: description || '',
        transport: tr,
        command: command || null,
        args: args || [],
        env: env || {},
        url: url || null,
        headers: headers || {},
        enabled: enabled ?? true,
      },
    };
  };

  router.post('/mcp', async (req, res) => {
    const { error, fields } = mcpFieldsFromBody(req.body);
    if (error) return res.status(400).json({ error });
    try {
      const server = await createMcpServer(fields);
      // Only assigned agents see the server's tools; no assignment = hidden.
      if (Array.isArray(req.body.agent_ids)) {
        await setMcpServerAgents(server.id, req.body.agent_ids);
      }
      res.json(server);
      reloadMcp();
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.put('/mcp/:id', async (req, res) => {
    const { error, fields } = mcpFieldsFromBody(req.body);
    if (error) return res.status(400).json({ error });
    try {
      const server = await updateMcpServer(req.params.id, fields);
      if (!server) return res.status(404).json({ error: 'not found' });
      if (Array.isArray(req.body.agent_ids)) {
        await setMcpServerAgents(server.id, req.body.agent_ids);
      }
      res.json(server);
      reloadMcp();
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/mcp/:id', async (req, res) => {
    const ok = await deleteMcpServer(req.params.id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
    reloadMcp();
  });

  // Ephemeral connect + listTools for the admin UI's Discover button.
  // Takes the definition from the body so unsaved forms can be tested too.
  router.post('/mcp/discover', async (req, res) => {
    const { transport, command, args, env, url, headers } = req.body;
    const tr = transport || 'stdio';
    if (tr === 'stdio' && !command) return res.status(400).json({ error: 'command required' });
    if (tr === 'http' && !url) return res.status(400).json({ error: 'url required' });
    if (!getMcpManager()) return res.status(503).json({ error: 'MCP manager not ready' });
    try {
      const tools = await getMcpManager().discover({
        transport: tr,
        command, args: args || [], env: env || {},
        url, headers: headers || {},
      });
      res.json({ tools });
      // Discover on an already-connected server doubles as a manual refresh:
      // re-list every live server and re-register on change, so the agent
      // sees the new tool set immediately instead of at the next reload.
      getMcpManager().refreshTools().catch(e => console.error('[mcp] tool refresh failed:', e.message));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
