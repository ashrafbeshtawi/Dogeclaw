import { mkdir } from 'node:fs/promises';
import config from './config.js';
import { shutdown as shutdownPools } from './db/pool.js';
import { ToolRegistry } from './tools/index.js';
import { Agent } from './agent.js';
import { CronRunner } from './cron/runner.js';
import { TelegramManager } from './channels/telegram.js';
import { McpManager } from './mcp/client.js';
import { registerMcpTools } from './tools/mcp.js';
import { createWebServer, setTelegramManager } from './web/server.js';
import { setCronRunner } from './tools/cron.js';

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
  await mkdir(config.paths.sessions, { recursive: true });
  await mkdir(config.paths.queues, { recursive: true });
  await mkdir(config.paths.logs, { recursive: true });

  // DB migrations are run by the Flyway service before this container starts.

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

  // Telegram
  const telegram = new TelegramManager(agent);
  setTelegramManager(telegram);

  // Cron runner
  const cronRunner = new CronRunner(agent, (chatId, text) => telegram.sendMessage(chatId, text));
  setCronRunner(cronRunner);
  await cronRunner.reload();

  // Web server
  const app = createWebServer(agent);

  // Start Telegram (loads channels from DB)
  if (config.database.agentUrl) {
    await telegram.start(app);
  }

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
