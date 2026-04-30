import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import config from '../config.js';

let cronRunner = null;

export function setCronRunner(runner) {
  cronRunner = runner;
}

async function loadJobs() {
  try {
    const data = await readFile(config.paths.cronFile, 'utf-8');
    return JSON.parse(data).jobs || [];
  } catch {
    return [];
  }
}

async function saveJobs(jobs) {
  await writeFile(config.paths.cronFile, JSON.stringify({ jobs }, null, 2), 'utf-8');
  if (cronRunner) cronRunner.reload();
}

export function register(registry) {
  registry.register('manage_cron', {
    type: 'function',
    function: {
      name: 'manage_cron',
      description: 'Create, remove, or list scheduled cron jobs. Jobs persist across restarts. Examples: add a job with expression "0 9 * * *" (daily at 9am), "*/30 * * * *" (every 30 min), "0 0 * * 1" (every Monday midnight). The prompt is what you will be asked to do when the job triggers.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'remove', 'list'], description: 'Action to perform' },
          id: { type: 'string', description: 'Job ID (for remove)' },
          expression: { type: 'string', description: 'Cron expression, e.g. "0 9 * * *" (for add)' },
          description: { type: 'string', description: 'What this job does (for add)' },
          prompt: { type: 'string', description: 'The prompt to send to the agent when triggered (for add)' },
          notify_chat: { type: 'number', description: 'Telegram chat ID to send the result to (optional, for add)' },
        },
        required: ['action'],
      },
    },
  }, async ({ action, id, expression, description, prompt, notify_chat }) => {
    const jobs = await loadJobs();

    switch (action) {
      case 'list':
        return { jobs };

      case 'add': {
        if (!expression || !prompt) return { error: 'expression and prompt are required' };
        const job = {
          id: randomUUID().slice(0, 8),
          expression,
          description: description || '',
          prompt,
          notifyChat: notify_chat || null,
          enabled: true,
          createdAt: new Date().toISOString(),
        };
        jobs.push(job);
        await saveJobs(jobs);
        return { created: job };
      }

      case 'remove': {
        if (!id) return { error: 'id is required' };
        const idx = jobs.findIndex(j => j.id === id);
        if (idx === -1) return { error: `Job ${id} not found` };
        const removed = jobs.splice(idx, 1)[0];
        await saveJobs(jobs);
        return { removed };
      }

      default:
        return { error: `Unknown action: ${action}` };
    }
  });
}
