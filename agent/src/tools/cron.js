import { listJobs, createJob, deleteJob } from '../db/crons.js';
import { getTimezone } from '../db/settings.js';
import { reloadCronJobs } from '../cron/runner.js';

export function register(registry) {
  registry.register('manage_cron', {
    type: 'function',
    function: {
      name: 'manage_cron',
      description:
        'Schedule a future task for yourself, list scheduled tasks, or cancel one. ' +
        'Use this when the user asks you to do something periodically (e.g. "every morning at 8 ask me how I slept") ' +
        'or once at a specific time ("remind me at 7pm tonight"). ' +
        'The delivery target (channel, chat, or web session) is determined automatically from the current conversation — ' +
        'you cannot send a cron to a different conversation.\n' +
        'For `add`: provide EITHER `expression` (recurring cron, e.g. "0 9 * * *") OR `run_at` (one-shot ISO timestamp, e.g. "2026-05-19T19:00:00Z"). ' +
        'When the job fires you will be invoked with the `prompt` as the instruction.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'remove', 'list'], description: 'Action to perform' },
          id: { type: 'number', description: 'Job id (for remove)' },
          expression: { type: 'string', description: 'Cron expression for recurring jobs, e.g. "0 9 * * *". Mutually exclusive with run_at.' },
          run_at: { type: 'string', description: 'ISO timestamp for a one-shot job, e.g. "2026-05-19T19:00:00Z". Mutually exclusive with expression.' },
          timezone: { type: 'string', description: 'IANA timezone (e.g. "Europe/Berlin"). Optional; defaults to the system timezone.' },
          description: { type: 'string', description: 'Short human description of what this job does (optional)' },
          prompt: { type: 'string', description: 'The instruction you want to receive when the job fires' },
        },
        required: ['action'],
      },
    },
  }, async (args, context = {}) => {
    const { action, id, expression, run_at, timezone, description, prompt } = args;

    if (action === 'list') {
      return { jobs: await listJobs() };
    }

    if (action === 'remove') {
      if (id == null) return { error: 'id is required' };
      const ok = await deleteJob(id);
      if (!ok) return { error: `Job ${id} not found` };
      reloadCronJobs();
      return { removed: id };
    }

    if (action === 'add') {
      if (!prompt) return { error: 'prompt is required' };

      const { agentId, channelId, chatId, sessionId } = context;
      if (!agentId) return { error: 'no agent in calling context — cannot schedule' };
      if (!channelId && !sessionId) {
        return { error: 'no channel or session in calling context — cron has nowhere to deliver' };
      }

      const isTelegram = !!(channelId && chatId);
      const tz = timezone || (await getTimezone());

      try {
        const job = await createJob({
          agentId,
          channelId: isTelegram ? channelId : null,
          chatId: isTelegram ? chatId : null,
          sessionId: isTelegram ? null : sessionId,
          expression: expression || null,
          runAt: run_at || null,
          timezone: tz,
          description: description || '',
          prompt,
        });
        reloadCronJobs();
        return { created: job };
      } catch (err) {
        return { error: err.message };
      }
    }

    return { error: `Unknown action: ${action}` };
  });
}
