import {
  recordRun,
  computeNextCronRun,
  findUnscheduledJobs,
  planNextRun,
  findDueJobs,
  claimDueRun,
} from '../db/crons.js';
import {
  loadSession,
  ensureSession,
  appendMessage,
  findActiveTelegramSession,
} from '../db/sessions.js';
import { withSessionLock } from '../lib/sessionLock.js';
import { runWithRetry } from '../lib/retry.js';
import { loadAgentRuntime } from '../db/agentRuntime.js';
import { adminQuery } from '../db/pool.js';
import { insertEventLog } from '../db/eventLogs.js';

const TICK_MS = 15_000;
// A recurring run found due later than this (the process was down over its
// slot) is skipped rather than fired late; the job just moves on to its next
// slot. One-shots always fire, however late — they happen only once.
const MAX_LATENESS_MS = 15 * 60_000;

// The schedule lives only in cron_jobs.next_run_at. Every tick plans the
// jobs that have no next run yet and claims the ones that are due; edits
// through db/crons.js take effect on the next tick without any reload.
export class CronRunner {
  #agent;
  #telegramManager;
  #tickTimer = null;

  constructor(agent, telegramManager) {
    this.#agent = agent;
    this.#telegramManager = telegramManager;
  }

  async start() {
    await this.#runTick();
    this.#tickTimer = setInterval(() => this.#runTick(), TICK_MS);
    console.log(`[cron] runner started; checking for due jobs every ${TICK_MS / 1000}s`);
  }

  async #runTick() {
    try {
      await this.#planUnscheduledJobs();
      await this.#startDueRuns();
    } catch (err) {
      console.error('[cron] tick:', err.message);
    }
  }

  async #planUnscheduledJobs() {
    for (const job of await findUnscheduledJobs()) {
      try {
        const nextRunAt = job.run_at
          ? new Date(job.run_at)
          : computeNextCronRun(job.expression, job.timezone, job.updated_at);
        await planNextRun(job, nextRunAt);
      } catch (err) {
        console.error(`[cron] job ${job.id} cannot be planned:`, err.message);
      }
    }
  }

  async #startDueRuns() {
    const now = new Date();
    for (const job of await findDueJobs()) {
      try {
        const nextRunAt = job.run_at ? null : computeNextCronRun(job.expression, job.timezone, now);
        const claimed = await claimDueRun(job, nextRunAt);
        if (!claimed) continue;
        const lateness = now - job.next_run_at;
        if (!job.run_at && lateness > MAX_LATENESS_MS) {
          console.warn(`[cron] job ${job.id} skipped its ${job.next_run_at.toISOString()} run, found ${Math.round(lateness / 60_000)} min late`);
          continue;
        }
        this.#dispatch(claimed).catch(err =>
          console.error(`[cron] job ${job.id} dispatch:`, err.message),
        );
      } catch (err) {
        console.error(`[cron] job ${job.id} cannot be claimed:`, err.message);
      }
    }
  }

  // `job` is the row as claimed, so a one-shot arrives already disabled.
  async #dispatch(job) {
    const jobId = job.id;
    const isTelegram = !!job.chat_id;
    const isOneShot = !!job.run_at;
    let sessionId;
    let channelRow = null;
    const startedAt = Date.now();
    let assistantContent = '';
    // 0 means the run never got past setup, so a failure there is
    // distinguishable in the event log from one the model actually attempted.
    let attempts = 0;

    console.log(`[cron] job ${jobId} input: ${job.prompt}`);

    try {
      const runtime = await loadAgentRuntime(job.agent_id);
      if (!runtime) throw new Error(`agent ${job.agent_id} not found`);
      if (!runtime.modelConfig) throw new Error(`agent ${job.agent_id} has no model assigned`);
      const agentRow = runtime.agent;

      if (isTelegram) {
        const cRes = await adminQuery('SELECT id, name FROM channels WHERE id = $1', [job.channel_id]);
        channelRow = cRes.rows[0];
        if (!channelRow) throw new Error(`channel ${job.channel_id} not found`);
        sessionId = await findActiveTelegramSession(job.channel_id, job.chat_id);
        if (!sessionId) sessionId = `tg-${channelRow.name}-${job.chat_id}`;
      } else {
        sessionId = job.session_id;
      }

      // Everything above is setup that fails the same way every time, so it
      // stays outside the retry. From here the run depends on the model
      // provider, which is where the transient failures live.
      //
      // ponytail: a retry re-runs the whole prompt, so tools the agent already
      // called before the failure run again. Safe for the read-then-write jobs
      // we have; if a job ever needs exactly-once tool execution, that needs
      // idempotency keys on the tool layer, not a smarter retry here. The
      // Telegram push is the last statement in the locked block and its own
      // errors are swallowed, so a retry can never double-send a message.
      await runWithRetry(async attempt => {
        attempts = attempt;
        await withSessionLock(sessionId, async () => {
          await ensureSession(sessionId, {
            agentId: job.agent_id,
            agentName: agentRow.name,
            source: isTelegram ? 'telegram' : 'web',
            channelId: isTelegram ? job.channel_id : null,
            channelName: channelRow?.name || null,
            chatId: isTelegram ? String(job.chat_id) : null,
          });

          const triggerLines = [
            'This is a scheduled run that you set up earlier.',
            `Job id: ${job.id}.`,
            ...(job.description ? [`Job description: ${job.description}.`] : []),
            `Run number: ${job.run_count + 1}.`,
            `Instruction: ${job.prompt}`,
            'Respond directly to the user as if you initiated the message. Do not mention this trigger.',
          ];
          const triggerNote = triggerLines.join('\n');

          const { messages: history } = await loadSession(sessionId);

          const result = await this.#agent.run('', history, {
            agentId: job.agent_id,
            agentName: agentRow.name,
            channelId: isTelegram ? job.channel_id : null,
            chatId: isTelegram ? String(job.chat_id) : null,
            sessionId,
            systemPrompt: agentRow.system_prompt,
            modelConfig: runtime.modelConfig,
            triggerNote,
          });

          const content = result.content || '';
          assistantContent = content;
          await appendMessage(sessionId, {
            role: 'assistant',
            content,
            thinking: result.thinking || null,
            toolCalls: result.toolCalls?.length ? result.toolCalls : null,
          });

          if (isTelegram && this.#telegramManager && content) {
            try {
              await this.#telegramManager.sendMessageVia(job.channel_id, job.chat_id, content);
            } catch (err) {
              console.error(`[cron] telegram push for job ${job.id}:`, err.message);
            }
          }
        });
      }, {
        onRetry: (err, attempt) =>
          console.warn(`[cron] job ${jobId} attempt ${attempt} failed: ${err.message} — retrying`),
      });

      if (attempts > 1) console.log(`[cron] job ${jobId} succeeded on attempt ${attempts}`);
      await recordRun(job.id, { status: 'ok', error: null });
      console.log(`[cron] job ${jobId} output: ${assistantContent}`);
      await insertEventLog({
        kind: 'cron_run',
        refId: jobId,
        status: 'success',
        input: job.prompt,
        output: assistantContent,
        durationMs: Date.now() - startedAt,
        meta: {
          agent_id: job.agent_id,
          session_id: sessionId,
          channel_id: isTelegram ? job.channel_id : null,
          chat_id: isTelegram ? String(job.chat_id) : null,
          one_shot: isOneShot,
          attempts,
        },
      }).catch(err => console.error(`[cron] event log insert failed:`, err.message));
    } catch (err) {
      console.error(`[cron] job ${jobId} failed:`, err.message);
      await recordRun(jobId, { status: 'error', error: err.message }).catch(() => {});
      await insertEventLog({
        kind: 'cron_run',
        refId: jobId,
        status: 'error',
        input: job.prompt,
        output: assistantContent || null,
        error: err.message,
        durationMs: Date.now() - startedAt,
        meta: {
          agent_id: job.agent_id,
          session_id: sessionId,
          channel_id: isTelegram ? job.channel_id : null,
          chat_id: isTelegram ? String(job.chat_id) : null,
          one_shot: isOneShot,
          attempts,
        },
      }).catch(logErr => console.error(`[cron] event log insert failed:`, logErr.message));
    }
  }

  stop() {
    clearInterval(this.#tickTimer);
    this.#tickTimer = null;
  }
}
