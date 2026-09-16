import express from 'express';
import { createHmac } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../config.js';

import { agentsRoutes } from './routes/agents.js';
import { channelsRoutes } from './routes/channels.js';
import { chatRoutes } from './routes/chat.js';
import { cronsRoutes } from './routes/crons.js';
import { eventLogsRoutes } from './routes/eventLogs.js';
import { mcpRoutes } from './routes/mcp.js';
import { modelsRoutes } from './routes/models.js';
import { searchEnginesRoutes } from './routes/searchEngines.js';
import { sessionsRoutes } from './routes/sessions.js';
import { settingsRoutes } from './routes/settings.js';
import { skillsRoutes } from './routes/skills.js';

// Re-exported so index.js keeps importing them from here; the state itself
// lives in managers.js now, where the routes can reach it too.
export { setTelegramManager, setMcpManager } from './managers.js';

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

  // --- API ---
  // Auth is applied once here rather than per-route. Login and logout are
  // registered above so they stay reachable without a cookie.
  //
  // Mount order is not cosmetic: within a router, a literal path must be
  // registered before a parameterised sibling that would swallow it (see
  // /search-engines/order vs /search-engines/:id). Across routers the paths
  // are disjoint, so this list can be read alphabetically.
  for (const routes of [
    agentsRoutes(),
    channelsRoutes(),
    chatRoutes(agent),
    cronsRoutes(),
    eventLogsRoutes(),
    mcpRoutes(),
    modelsRoutes(),
    searchEnginesRoutes(),
    sessionsRoutes(),
    settingsRoutes(),
    skillsRoutes(),
  ]) {
    app.use('/api', authMiddleware, routes);
  }

  return app;
}
