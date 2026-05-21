import cron from 'node-cron';
import {
  listEnabledJobs,
  getJob,
  recordRun,
  disableJob,
  findDueOneShots,
} from '../db/crons.js';
import { getTimezone } from '../db/settings.js';
import {
  loadSession,
  ensureSession,
  appendMessage,
  findActiveTelegramSession,
} from '../db/sessions.js';
import { withSessionLock } from '../lib/sessionLock.js';
import { adminQuery } from '../db/pool.js';

const ONE_SHOT_TICK_MS = 60_000;

let activeRunner = null;

export function setActiveCronRunner(runner) {
  activeRunner = runner;
}

export async function reloadCronJobs() {
  if (activeRunner) {
    try { await activeRunner.reload(); }
    catch (err) { console.error('[cron] reload failed:', err.message); }
  }
}

export class CronRunner {
  #agent;
  #telegramManager;
  #tasks = new Map();
  #oneShotTimer = null;

  constructor(agent, telegramManager) {
    this.#agent = agent;
    this.#telegramManager = telegramManager;
  }

  async start() {
    await this.reload();
    this.#oneShotTimer = setInterval(() => {
      this.#tickOneShots().catch(err => console.error('[cron] one-shot tick:', err.message));
    }, ONE_SHOT_TICK_MS);
  }

  async reload() {
    for (const task of this.#tasks.values()) {
      try { task.stop(); } catch {}
    }
    this.#tasks.clear();

    const defaultTz = await getTimezone();

    let jobs;
    try {
      jobs = await listEnabledJobs();
    } catch (err) {
      console.error('[cron] failed to load jobs:', err.message);
      return;
    }

    for (const job of jobs) {
      if (!job.expression) continue;
      if (!cron.validate(job.expression)) {
        console.warn(`[cron] job ${job.id} has invalid expression "${job.expression}", skipping`);
        continue;
      }
      const tz = job.timezone || defaultTz;
      try {
        const task = cron.schedule(job.expression, () => {
          this.#dispatch(job.id).catch(err =>
            console.error(`[cron] job ${job.id} dispatch:`, err.message),
          );
        }, { timezone: tz });
        this.#tasks.set(job.id, task);
      } catch (err) {
        console.error(`[cron] failed to schedule job ${job.id}:`, err.message);
      }
    }

    console.log(`[cron] Loaded ${this.#tasks.size} recurring job(s); one-shot tick every ${ONE_SHOT_TICK_MS / 1000}s`);
  }

  async #tickOneShots() {
    const due = await findDueOneShots();
    for (const job of due) {
      this.#dispatch(job.id).catch(err =>
        console.error(`[cron] one-shot ${job.id} dispatch:`, err.message),
      );
    }
  }

  async #dispatch(jobId) {
    const job = await getJob(jobId);
    if (!job || !job.enabled) return;

    const isTelegram = !!job.chat_id;
    const isOneShot = !!job.run_at;
    let sessionId;
    let channelRow = null;

    try {
      const aRes = await adminQuery(
        `SELECT a.id, a.name, a.system_prompt,
                m.base_url, m.model_id, m.think, m.accepts, m.provider, m.api_key
           FROM agents a LEFT JOIN models m ON a.model_id = m.id
          WHERE a.id = $1`,
        [job.agent_id],
      );
      const agentRow = aRes.rows[0];
      if (!agentRow) throw new Error(`agent ${job.agent_id} not found`);
      if (!agentRow.model_id) throw new Error(`agent ${job.agent_id} has no model assigned`);

      if (isTelegram) {
        const cRes = await adminQuery('SELECT id, name FROM channels WHERE id = $1', [job.channel_id]);
        channelRow = cRes.rows[0];
        if (!channelRow) throw new Error(`channel ${job.channel_id} not found`);
        sessionId = await findActiveTelegramSession(job.channel_id, job.chat_id);
        if (!sessionId) sessionId = `tg-${channelRow.name}-${job.chat_id}`;
      } else {
        sessionId = job.session_id;
      }

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

        const modelConfig = {
          base_url: agentRow.base_url,
          model_id: agentRow.model_id,
          think: agentRow.think,
          accepts: agentRow.accepts || ['text'],
          provider: agentRow.provider || 'ollama',
          apiKey: agentRow.api_key,
        };

        const result = await this.#agent.run('', history, {
          agentId: job.agent_id,
          channelId: isTelegram ? job.channel_id : null,
          chatId: isTelegram ? String(job.chat_id) : null,
          sessionId,
          systemPrompt: agentRow.system_prompt,
          modelConfig,
          triggerNote,
        });

        const content = result.content || '';
        await appendMessage(sessionId, {
          role: 'assistant',
          content,
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

      await recordRun(job.id, { status: 'ok', error: null });
    } catch (err) {
      console.error(`[cron] job ${jobId} failed:`, err.message);
      await recordRun(jobId, { status: 'error', error: err.message }).catch(() => {});
    } finally {
      if (isOneShot) await disableJob(jobId).catch(() => {});
    }
  }

  stop() {
    for (const task of this.#tasks.values()) {
      try { task.stop(); } catch {}
    }
    this.#tasks.clear();
    if (this.#oneShotTimer) {
      clearInterval(this.#oneShotTimer);
      this.#oneShotTimer = null;
    }
  }
}
