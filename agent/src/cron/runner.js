import cron from 'node-cron';
import { readFile } from 'node:fs/promises';
import config from '../config.js';

export class CronRunner {
  #agent;
  #sendTelegram;
  #tasks = new Map();

  constructor(agent, sendTelegram) {
    this.#agent = agent;
    this.#sendTelegram = sendTelegram;
  }

  async reload() {
    // Stop all existing tasks
    for (const task of this.#tasks.values()) task.stop();
    this.#tasks.clear();

    // Load jobs from file
    let jobs = [];
    try {
      const data = await readFile(config.paths.cronFile, 'utf-8');
      jobs = JSON.parse(data).jobs || [];
    } catch {
      return; // No cron file yet
    }

    for (const job of jobs) {
      if (!job.enabled || !cron.validate(job.expression)) continue;

      const task = cron.schedule(job.expression, async () => {
        console.log(`[cron] Firing job ${job.id}: ${job.description}`);
        try {
          const result = await this.#agent.run(
            job.prompt,
            [],
            {
              agentId: job.agentId || 1,
              systemNote: `This task was triggered by cron job: ${job.description} (id: ${job.id})`,
            },
          );

          if (job.notifyChat && this.#sendTelegram) {
            await this.#sendTelegram(job.notifyChat, result.content);
          }
        } catch (err) {
          console.error(`[cron] Job ${job.id} failed:`, err.message);
        }
      });

      this.#tasks.set(job.id, task);
    }

    console.log(`[cron] Loaded ${this.#tasks.size} jobs`);
  }

  stop() {
    for (const task of this.#tasks.values()) task.stop();
    this.#tasks.clear();
  }
}
