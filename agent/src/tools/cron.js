import { listJobs, createJob, deleteJob, getJob } from '../db/crons.js';
import { getTimezone } from '../db/settings.js';
import { reloadCronJobs } from '../cron/runner.js';
import { makeCronHandlers } from '../lib/cronTools.js';

// One flat tool per operation instead of a single tool with an action enum —
// smaller models call simple flat schemas far more reliably (same rationale
// as the db_* tools). Handlers live in lib/cronTools.js for testability.

export function register(registry) {
  const handlers = makeCronHandlers({ listJobs, getJob, createJob, deleteJob, getTimezone, reloadCronJobs });

  registry.register('add_cron', {
    type: 'function',
    function: {
      name: 'add_cron',
      description:
        'Schedule a future task for yourself. Use this when the user asks you to do something periodically ' +
        '(e.g. "every morning at 8 ask me how I slept") or once at a specific time ("remind me at 7pm tonight"). ' +
        'Provide EITHER expression (recurring cron, e.g. "0 9 * * *") OR run_at (one-shot ISO timestamp) — never both. ' +
        'When the job fires you will be invoked with the prompt as the instruction. ' +
        'The delivery target (channel, chat, or web session) is determined automatically from the current conversation — ' +
        'you cannot send a cron to a different conversation.',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'Cron expression for recurring jobs, e.g. "0 9 * * *". Mutually exclusive with run_at.' },
          run_at: { type: 'string', description: 'ISO timestamp for a one-shot job, e.g. "2026-05-19T19:00:00Z". Mutually exclusive with expression.' },
          timezone: { type: 'string', description: 'IANA timezone (e.g. "Europe/Berlin"). Optional; defaults to the system timezone.' },
          description: { type: 'string', description: 'Short human description of what this job does (optional)' },
          prompt: { type: 'string', description: 'The instruction you want to receive when the job fires' },
        },
        required: ['prompt'],
      },
    },
  }, handlers.addCron);

  registry.register('list_crons', {
    type: 'function',
    function: {
      name: 'list_crons',
      description:
        'List your scheduled jobs for this conversation, paginated. Returns total, the current offset, and ' +
        'next_offset when more pages exist. Prompts are shown truncated — use get_cron for the full details of one job.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Jobs per page (default 20, max 50)' },
          offset: { type: 'number', description: 'Number of jobs to skip (default 0); pass next_offset from the previous page' },
        },
      },
    },
  }, handlers.listCrons);

  registry.register('get_cron', {
    type: 'function',
    function: {
      name: 'get_cron',
      description: 'Get the full details of one scheduled job by id, including the untruncated prompt and the last error if the last run failed. Only jobs of this conversation are visible.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Job id (from list_crons)' },
        },
        required: ['id'],
      },
    },
  }, handlers.getCron);

  registry.register('remove_cron', {
    type: 'function',
    function: {
      name: 'remove_cron',
      description: 'Cancel a scheduled job by id. Only jobs of this conversation can be removed.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Job id (from list_crons)' },
        },
        required: ['id'],
      },
    },
  }, handlers.removeCron);
}
