import express from 'express';
import { createHmac, randomUUID } from 'node:crypto';
import { readFile, writeFile, readdir, mkdir, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../config.js';
import { adminQuery as query } from '../db/pool.js';
import { transcribeAudio } from '../audio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function sign(data) {
  return createHmac('sha256', config.web.secret).update(data).digest('hex');
}

function authMiddleware(req, res, next) {
  const token = req.headers.cookie?.match(/dogeclaw_token=([^;]+)/)?.[1];
  if (!token || sign('authenticated') !== token) {
    // For page requests, redirect to login
    if (req.accepts('html')) return res.redirect('/login');
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

let telegramManager = null;

export function setTelegramManager(tm) {
  telegramManager = tm;
}

export function createWebServer(agent) {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  // Static files
  app.use('/static', express.static(join(__dirname, 'public')));

  // --- Auth ---
  app.get('/login', (req, res) => res.sendFile(join(__dirname, 'public', 'login.html')));

  app.post('/api/login', (req, res) => {
    const { user, password } = req.body;
    if (user === config.web.user && password === config.web.password) {
      const token = sign('authenticated');
      res.setHeader('Set-Cookie', `dogeclaw_token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
      return res.json({ ok: true });
    }
    res.status(401).json({ error: 'invalid credentials' });
  });

  app.post('/api/logout', (req, res) => {
    res.setHeader('Set-Cookie', 'dogeclaw_token=; Path=/; HttpOnly; Max-Age=0');
    res.json({ ok: true });
  });

  // --- Protected pages ---
  app.get('/', authMiddleware, (req, res) => res.sendFile(join(__dirname, 'public', 'index.html')));
  app.get('/admin', authMiddleware, (req, res) => res.sendFile(join(__dirname, 'public', 'admin.html')));

  // --- Public config (non-sensitive) ---
  app.get('/api/config', authMiddleware, (req, res) => {
    res.json({
      telegramMode: config.telegram.mode,
      webhookUrl: config.telegram.webhookUrl || null,
    });
  });

  // --- Sessions ---
  app.get('/api/sessions', authMiddleware, async (req, res) => {
    try {
      await mkdir(config.paths.sessions, { recursive: true });
      const files = await readdir(config.paths.sessions);
      const sessions = [];
      for (const f of files.filter(f => f.endsWith('.json'))) {
        try {
          const data = JSON.parse(await readFile(join(config.paths.sessions, f), 'utf-8'));
          const id = f.replace('.json', '');
          const lastMsg = data.messages?.[data.messages.length - 1]?.content?.slice(0, 60) || '';
          sessions.push({ id, agentId: data.agentId, agentName: data.agentName, source: data.source || 'web', preview: lastMsg });
        } catch {}
      }
      res.json({ sessions });
    } catch { res.json({ sessions: [] }); }
  });

  app.get('/api/sessions/:id', authMiddleware, async (req, res) => {
    try {
      const file = join(config.paths.sessions, `${req.params.id}.json`);
      const data = JSON.parse(await readFile(file, 'utf-8'));
      res.json(data);
    } catch { res.status(404).json({ error: 'not found' }); }
  });

  app.delete('/api/sessions/:id', authMiddleware, async (req, res) => {
    try {
      await unlink(join(config.paths.sessions, `${req.params.id}.json`));
      res.json({ ok: true });
    } catch { res.status(404).json({ error: 'not found' }); }
  });

  // --- Chat (SSE streaming) ---
  app.post('/api/chat', authMiddleware, async (req, res) => {
    const { message, sessionId: reqSessionId, agentId, images, audio, audioMime } = req.body;
    if (!message && !images?.length && !audio) return res.status(400).json({ error: 'message, images, or audio required' });

    const sid = reqSessionId || randomUUID();
    const sessionData = await loadSession(sid);
    const history = sessionData.messages || [];

    // Load agent + model config
    let agentConfig = null;
    let modelConfig = null;
    const aid = agentId || sessionData.agentId;
    if (!aid) return res.status(400).json({ error: 'No agent selected. Create an agent in the admin UI first.' });
    try {
      const result = await query(
        `SELECT a.*, m.base_url, m.model_id as ollama_model, m.think, m.accepts, m.provider, m.api_key
         FROM agents a LEFT JOIN models m ON a.model_id = m.id WHERE a.id = $1`, [aid]);
      agentConfig = result.rows[0];
      if (agentConfig) {
        modelConfig = {
          base_url: agentConfig.base_url,
          model_id: agentConfig.ollama_model,
          think: agentConfig.think,
          accepts: agentConfig.accepts || ['text'],
          provider: agentConfig.provider || 'ollama',
          apiKey: agentConfig.api_key,
        };
      }
    } catch {}

    if (!agentConfig) return res.status(404).json({ error: 'Agent not found.' });
    if (!modelConfig?.model_id) return res.status(400).json({ error: 'This agent has no model assigned. Configure it in the admin UI.' });

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const send = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      let fullContent = '';
      let fullThinking = '';

      const result = await agent.run(message || '', history, {
        agentId: aid,
        systemPrompt: agentConfig?.system_prompt,
        modelConfig,
        images: images || undefined,
        audio: audio || undefined,
        audioMime: audioMime || undefined,
        onEvent: (type, data) => {
          if (type === 'thinking') { fullThinking += data; send('thinking', data); }
          else if (type === 'content') { fullContent += data; send('content', data); }
          else if (type === 'tool_calls') { send('tool_calls', data); }
          else if (type === 'tool_result') { send('tool_result', data); }
          else if (type === 'status') { send('status', data); }
          else if (type === 'transcript') { send('transcript', data); }
        },
      });

      const finalContent = fullContent || result.content;

      const userLabel = audio ? `[voice] ${message || '(audio)'}` : (message || '(image)');
      history.push({ role: 'user', content: userLabel, ...(images?.length ? { hasImage: true } : {}), ...(audio ? { hasAudio: true } : {}) });
      history.push({
        role: 'assistant', content: finalContent,
        ...(fullThinking ? { thinking: fullThinking } : {}),
        ...(result.toolCalls?.length ? { toolCalls: result.toolCalls } : {}),
      });
      while (history.length > 40) history.shift();

      await saveSession(sid, {
        messages: history,
        agentId: aid,
        agentName: agentConfig?.name || 'default',
      });

      send('done', { sessionId: sid });
    } catch (err) {
      send('error', { message: err.message });
    }

    res.end();
  });

  // --- Models CRUD ---
  app.get('/api/models', authMiddleware, async (req, res) => {
    const result = await query('SELECT * FROM models ORDER BY id');
    res.json({ models: result.rows });
  });

  const reloadTelegram = () => {
    if (telegramManager) telegramManager.reload().catch(e => console.error('[telegram] reload failed:', e.message));
  };

  app.post('/api/models', authMiddleware, async (req, res) => {
    const { name, provider, base_url, model_id, api_key, think, accepts } = req.body;
    if (!name || !model_id) return res.status(400).json({ error: 'name and model_id required' });
    const result = await query(
      'INSERT INTO models (name, provider, base_url, model_id, api_key, think, accepts) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [name, provider || 'ollama', base_url || 'http://ollama:11434', model_id, api_key || null, think || false, JSON.stringify(accepts || ['text'])],
    );
    res.json(result.rows[0]);
    reloadTelegram();
  });

  app.put('/api/models/:id', authMiddleware, async (req, res) => {
    const { name, provider, base_url, model_id, api_key, think, accepts } = req.body;
    const result = await query(
      `UPDATE models SET name = COALESCE($1, name), provider = COALESCE($2, provider),
       base_url = COALESCE($3, base_url), model_id = COALESCE($4, model_id),
       api_key = COALESCE($5, api_key), think = COALESCE($6, think), accepts = COALESCE($7, accepts)
       WHERE id = $8 RETURNING *`,
      [name, provider, base_url, model_id, api_key, think, accepts ? JSON.stringify(accepts) : null, req.params.id],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.json(result.rows[0]);
    reloadTelegram();
  });

  app.post('/api/models/test', authMiddleware, async (req, res) => {
    const { provider, base_url, model_id, api_key } = req.body;
    try {
      if (provider === 'openrouter') {
        const r = await fetch(`${base_url}/api/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api_key}` },
          body: JSON.stringify({ model: model_id, messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }], max_tokens: 10 }),
        });
        if (!r.ok) { const t = await r.text(); return res.json({ ok: false, error: `${r.status}: ${t.slice(0, 200)}` }); }
        const data = await r.json();
        res.json({ ok: true, reply: data.choices?.[0]?.message?.content || '(empty)' });
      } else if (provider === 'google') {
        const url = `${base_url || 'https://generativelanguage.googleapis.com'}/v1beta/models/${model_id}:generateContent?key=${api_key}`;
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Say "ok" and nothing else.' }] }] }),
        });
        if (!r.ok) { const t = await r.text(); return res.json({ ok: false, error: `${r.status}: ${t.slice(0, 200)}` }); }
        const data = await r.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '(empty)';
        res.json({ ok: true, reply: text });
      } else {
        const r = await fetch(`${base_url || 'http://ollama:11434'}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: model_id, messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }], stream: false, think: false }),
        });
        if (!r.ok) { const t = await r.text(); return res.json({ ok: false, error: `${r.status}: ${t.slice(0, 200)}` }); }
        const data = await r.json();
        res.json({ ok: true, reply: data.message?.content || '(empty)' });
      }
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  app.delete('/api/models/:id', authMiddleware, async (req, res) => {
    await query('DELETE FROM models WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
    reloadTelegram();
  });

  // --- Agents CRUD ---
  app.get('/api/agents', authMiddleware, async (req, res) => {
    const result = await query(
      `SELECT a.*, m.name as model_name, m.model_id as ollama_model, m.think, m.accepts,
        COALESCE((SELECT json_agg(skill_id) FROM agent_skills WHERE agent_id = a.id), '[]'::json) AS skill_ids
       FROM agents a LEFT JOIN models m ON a.model_id = m.id ORDER BY a.id`);
    res.json({ agents: result.rows });
  });

  app.post('/api/agents', authMiddleware, async (req, res) => {
    const { name, system_prompt, model_id } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const result = await query(
      'INSERT INTO agents (name, system_prompt, model_id) VALUES ($1, $2, $3) RETURNING *',
      [name, system_prompt || '', model_id || null],
    );
    res.json(result.rows[0]);
    reloadTelegram();
  });

  app.put('/api/agents/:id', authMiddleware, async (req, res) => {
    const { name, system_prompt, model_id } = req.body;
    const result = await query(
      'UPDATE agents SET name = COALESCE($1, name), system_prompt = COALESCE($2, system_prompt), model_id = COALESCE($3, model_id) WHERE id = $4 RETURNING *',
      [name, system_prompt, model_id, req.params.id],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.json(result.rows[0]);
    reloadTelegram();
  });

  app.delete('/api/agents/:id', authMiddleware, async (req, res) => {
    await query('DELETE FROM agents WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
    reloadTelegram();
  });

  // --- Skills CRUD ---
  app.get('/api/skills', authMiddleware, async (req, res) => {
    const result = await query(`
      SELECT s.*, COALESCE(
        (SELECT json_agg(agent_id) FROM agent_skills WHERE skill_id = s.id),
        '[]'::json
      ) AS agent_ids
      FROM skills s ORDER BY s.id
    `);
    res.json({ skills: result.rows });
  });

  app.post('/api/skills', authMiddleware, async (req, res) => {
    const { name, description, content, agent_ids } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const result = await query(
      'INSERT INTO skills (name, description, content) VALUES ($1, $2, $3) RETURNING *',
      [name, description || '', content || ''],
    );
    const skill = result.rows[0];
    if (Array.isArray(agent_ids) && agent_ids.length) {
      for (const aid of agent_ids) {
        await query('INSERT INTO agent_skills (skill_id, agent_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [skill.id, aid]);
      }
    }
    res.json(skill);
  });

  app.put('/api/skills/:id', authMiddleware, async (req, res) => {
    const { name, description, content, agent_ids } = req.body;
    const result = await query(
      'UPDATE skills SET name = COALESCE($1, name), description = COALESCE($2, description), content = COALESCE($3, content) WHERE id = $4 RETURNING *',
      [name, description, content, req.params.id],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'not found' });
    if (Array.isArray(agent_ids)) {
      await query('DELETE FROM agent_skills WHERE skill_id = $1', [req.params.id]);
      for (const aid of agent_ids) {
        await query('INSERT INTO agent_skills (skill_id, agent_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, aid]);
      }
    }
    res.json(result.rows[0]);
  });

  app.delete('/api/skills/:id', authMiddleware, async (req, res) => {
    await query('DELETE FROM skills WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  });

  // Manage skill assignment from agent perspective
  app.put('/api/agents/:id/skills', authMiddleware, async (req, res) => {
    const { skill_ids } = req.body;
    if (!Array.isArray(skill_ids)) return res.status(400).json({ error: 'skill_ids array required' });
    await query('DELETE FROM agent_skills WHERE agent_id = $1', [req.params.id]);
    for (const sid of skill_ids) {
      await query('INSERT INTO agent_skills (agent_id, skill_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, sid]);
    }
    res.json({ ok: true });
  });

  // --- Channels CRUD ---
  app.get('/api/channels', authMiddleware, async (req, res) => {
    const result = await query(`
      SELECT c.*, a.name as agent_name
      FROM channels c JOIN agents a ON c.agent_id = a.id
      ORDER BY c.id
    `);
    res.json({ channels: result.rows });
  });

  app.post('/api/channels', authMiddleware, async (req, res) => {
    const { agent_id, type, name, config: channelConfig, response_mode, response_interval } = req.body;
    if (!agent_id || !type || !name) return res.status(400).json({ error: 'agent_id, type, and name required' });
    const result = await query(
      'INSERT INTO channels (agent_id, type, name, config, response_mode, response_interval) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [agent_id, type, name, JSON.stringify(channelConfig || {}), response_mode || 'immediate', response_interval],
    );
    // Auto-set webhook for telegram channels in webhook mode
    if (type === 'telegram' && config.telegram.mode === 'webhook' && config.telegram.webhookUrl && channelConfig?.token) {
      const whUrl = `${config.telegram.webhookUrl}/webhook/${name}`;
      fetch(`https://api.telegram.org/bot${channelConfig.token}/setWebhook?url=${encodeURIComponent(whUrl)}`)
        .then(r => r.json()).then(d => console.log(`[telegram] Webhook set for ${name}:`, d.ok ? 'ok' : d.description))
        .catch(e => console.error(`[telegram] Failed to set webhook for ${name}:`, e.message));
    }
    res.json(result.rows[0]);
    if (telegramManager) telegramManager.reload().catch(e => console.error('[telegram] reload failed:', e.message));
  });

  app.put('/api/channels/:id', authMiddleware, async (req, res) => {
    const { agent_id, name, config: channelConfig, response_mode, response_interval, enabled } = req.body;
    const result = await query(
      `UPDATE channels SET
        agent_id = COALESCE($1, agent_id), name = COALESCE($2, name),
        config = COALESCE($3, config), response_mode = COALESCE($4, response_mode),
        response_interval = COALESCE($5, response_interval), enabled = COALESCE($6, enabled)
      WHERE id = $7 RETURNING *`,
      [agent_id, name, channelConfig ? JSON.stringify(channelConfig) : null, response_mode, response_interval, enabled, req.params.id],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.json(result.rows[0]);
    if (telegramManager) telegramManager.reload().catch(e => console.error('[telegram] reload failed:', e.message));
  });

  app.delete('/api/channels/:id', authMiddleware, async (req, res) => {
    // Get channel info before deleting (to remove webhook)
    try {
      const ch = await query('SELECT * FROM channels WHERE id = $1', [req.params.id]);
      const channel = ch.rows[0];
      if (channel?.type === 'telegram' && channel.config?.token) {
        fetch(`https://api.telegram.org/bot${channel.config.token}/deleteWebhook`)
          .then(r => r.json()).then(d => console.log(`[telegram] Webhook deleted for ${channel.name}:`, d.ok ? 'ok' : d.description))
          .catch(e => console.error(`[telegram] Failed to delete webhook:`, e.message));
      }
    } catch {}
    await query('DELETE FROM channels WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
    if (telegramManager) telegramManager.reload().catch(e => console.error('[telegram] reload failed:', e.message));
  });

  return app;
}

async function loadSession(id) {
  try {
    const file = join(config.paths.sessions, `${id}.json`);
    return JSON.parse(await readFile(file, 'utf-8'));
  } catch { return { messages: [] }; }
}

async function saveSession(id, data) {
  await mkdir(config.paths.sessions, { recursive: true });
  await writeFile(join(config.paths.sessions, `${id}.json`), JSON.stringify(data), 'utf-8');
}
