// Handlers for the agent-facing cron tools (add_cron / list_crons /
// get_cron / remove_cron). Dependencies are injected so the stdlib-only
// unit tests can exercise pagination, ownership scoping, and validation
// without a database — same pattern as skillTools.js.
//
// Ownership: add_cron binds every job to the calling conversation
// (telegram channel+chat, or web session); list/get/remove enforce the
// same boundary via ownsJob — foreign ids read as "not found" on purpose.

import { ownsJob } from './cronOwnership.js';

const LIST_LIMIT_DEFAULT = 20;
const LIST_LIMIT_MAX = 50;
const PROMPT_PREVIEW_LEN = 120;

// Compact row for listings: full prompts pushed a 24-job list past the 12k
// tool-result cap, and the model read the cut-off tail as "these jobs don't
// exist". get_cron returns the full prompt.
function toJobSummary(j) {
  return {
    id: j.id,
    expression: j.expression,
    run_at: j.run_at,
    timezone: j.timezone,
    description: j.description,
    prompt: (j.prompt || '').length > PROMPT_PREVIEW_LEN
      ? `${j.prompt.slice(0, PROMPT_PREVIEW_LEN)}…`
      : j.prompt,
    enabled: j.enabled,
    last_run_at: j.last_run_at,
    last_status: j.last_status,
    run_count: j.run_count,
  };
}

export function makeCronHandlers({ listJobs, getJob, createJob, deleteJob, getTimezone, reloadCronJobs }) {
  return {
    async addCron({ expression, run_at, timezone, description, prompt }, context = {}) {
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
    },

    async listCrons({ limit, offset } = {}, context = {}) {
      const owned = (await listJobs()).filter(j => ownsJob(j, context));
      const pageSize = Math.min(Math.max(1, limit || LIST_LIMIT_DEFAULT), LIST_LIMIT_MAX);
      const start = Math.max(0, offset || 0);
      const page = owned.slice(start, start + pageSize);
      return {
        total: owned.length,
        offset: start,
        jobs: page.map(toJobSummary),
        ...(start + pageSize < owned.length && { next_offset: start + pageSize }),
      };
    },

    async getCron({ id } = {}, context = {}) {
      if (id == null) return { error: 'id is required' };
      const job = await getJob(id);
      if (!job || !ownsJob(job, context)) return { error: `Job ${id} not found` };
      return {
        id: job.id,
        expression: job.expression,
        run_at: job.run_at,
        timezone: job.timezone,
        description: job.description,
        prompt: job.prompt,
        enabled: job.enabled,
        last_run_at: job.last_run_at,
        last_status: job.last_status,
        last_error: job.last_error,
        run_count: job.run_count,
        created_at: job.created_at,
      };
    },

    async removeCron({ id } = {}, context = {}) {
      if (id == null) return { error: 'id is required' };
      const job = await getJob(id);
      if (!job || !ownsJob(job, context)) return { error: `Job ${id} not found` };
      await deleteJob(id);
      reloadCronJobs();
      return { removed: id };
    },
  };
}
