import { buildDatabaseUrls } from './lib/databaseUrls.js';

const env = process.env;

const config = {
  ollama: {
    url: env.DOGECLAW_OLLAMA_URL || 'http://ollama:11434',
  },
  web: {
    port: parseInt(env.DOGECLAW_PORT || '3000', 10),
    user: env.DOGECLAW_WEB_USER || 'admin',
    password: env.DOGECLAW_WEB_PASSWORD || 'changeme',
    secret: env.DOGECLAW_WEB_SECRET || 'dogeclaw-default-secret-change-me',
  },
  // URLs are derived from POSTGRES_* primitives (see lib/databaseUrls.js).
  // DOGECLAW_ADMIN_DATABASE_URL / DOGECLAW_DATABASE_URL are still honored
  // as overrides for backward-compat with v2.0.0 deploys.
  database: buildDatabaseUrls(env),
  telegram: {
    mode: env.DOGECLAW_TELEGRAM_MODE || 'polling',
    webhookUrl: env.DOGECLAW_WEBHOOK_URL || '',
  },
  workspace: env.DOGECLAW_WORKSPACE || '/root/agent-workspace',
};

config.paths = {
  files: `${config.workspace}/files`,
  sessions: `${config.workspace}/sessions`,
  queues: `${config.workspace}/queues`,
  logs: `${config.workspace}/logs`,
  cronFile: `${config.workspace}/cron.json`,
  mcpConfigFile: `${config.workspace}/mcp-config.json`,
  // SQL migrations the agent applies on boot. Baked into the image at
  // /opt/migrations/sql; dev compose mounts the host source over it.
  migrationsDir: '/opt/migrations/sql',
};

export default config;
