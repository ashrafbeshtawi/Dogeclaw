import { mkdir } from 'node:fs/promises';
import config from './config.js';
import { shutdown as shutdownPools } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { ToolRegistry } from './tools/index.js';
import { Agent } from './agent.js';
import { CronRunner, setActiveCronRunner } from './cron/runner.js';
import { EventLogCleanup } from './cron/logCleanup.js';
import { TelegramManager } from './channels/telegram.js';
import { McpManager } from './mcp/client.js';
import { registerMcpTools } from './tools/mcp.js';
import { createWebServer, setTelegramManager } from './web/server.js';
import { importLegacyData } from './migrate/importLegacy.js';

import { register as registerExec } from './tools/exec.js';
import { register as registerFiles } from './tools/files.js';
import { register as registerCron } from './tools/cron.js';
import { register as registerDb } from './tools/db.js';
import { register as registerWeb } from './tools/web.js';
import { register as registerSkills } from './tools/skills.js';

async function main() {
  console.log('[dogeclaw] Starting...');

  // Ensure workspace directories exist
  await mkdir(config.paths.files, { recursive: true });
  await mkdir(config.paths.logs, { recursive: true });

  // Run any pending DB migrations before anything else touches the pool.
  // Fail-fast — getAdminPool() throws if DOGECLAW_ADMIN_DATABASE_URL is
  // unset, which propagates up to main().catch and exits non-zero.
  await runMigrations();

  // Tool registry
  const registry = new ToolRegistry();
  registerExec(registry);
  registerFiles(registry);
  registerCron(registry);
  if (config.database.agentUrl) registerDb(registry);
  registerWeb(registry);
  if (config.database.agentUrl) registerSkills(registry);

  // MCP clients
  const mcp = new McpManager();
  await mcp.start();
  registerMcpTools(registry, mcp);

  // Agent
  const agent = new Agent(registry);

  // Telegram + cron runner. Telegram is constructed up-front so the cron
  // dispatcher can push messages back through it.
  const telegram = new TelegramManager(agent);
  setTelegramManager(telegram);

  const cronRunner = new CronRunner(agent, telegram);
  setActiveCronRunner(cronRunner);

  // Web server
  const app = createWebServer(agent);

  // Start Telegram (loads channels from DB; needs the express app for webhook routes)
  if (config.database.agentUrl) {
    await telegram.start(app);
  }

  // One-shot import of pre-DB cron.json + session JSON files. Safe to call
  // every boot — no-ops once the target tables are populated.
  if (config.database.agentUrl) {
    await importLegacyData();
  }

  // Now that channels + legacy data are loaded, start the cron runner.
  await cronRunner.start();

  // Background daily pruning of event_logs, governed by the
  // event_log_retention_days setting.
  const eventLogCleanup = new EventLogCleanup();
  await eventLogCleanup.start();

  // Start HTTP server
  app.listen(config.web.port, '0.0.0.0', () => {
    console.log(`[dogeclaw] Web UI at http://0.0.0.0:${config.web.port}`);
    console.log(`[dogeclaw] Tools: ${registry.list().join(', ')}`);
    console.log(`[dogeclaw] Ready`);
  });

  const shutdown = async () => {
    console.log('[dogeclaw] Shutting down...');
    telegram.stop();
    cronRunner.stop();
    eventLogCleanup.stop();
    await mcp.stop();
    await shutdownPools();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(err => {
  console.error('[dogeclaw] Fatal:', err);
  process.exit(1);
});
