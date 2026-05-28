import { deleteEventLogsOlderThan } from '../db/eventLogs.js';
import { getSetting } from '../db/settings.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 14;

export class EventLogCleanup {
  #timer = null;

  async start() {
    // Run once at boot so a freshly-restarted agent prunes immediately rather
    // than waiting a full day.
    this.tick().catch(err => console.error('[event-log-cleanup] initial tick:', err.message));
    this.#timer = setInterval(() => {
      this.tick().catch(err => console.error('[event-log-cleanup] tick:', err.message));
    }, ONE_DAY_MS);
    if (this.#timer.unref) this.#timer.unref();
  }

  async tick() {
    const value = await getSetting('event_log_retention_days', DEFAULT_RETENTION_DAYS);
    const days = Number(value);
    if (!Number.isFinite(days) || days <= 0) return;
    const deleted = await deleteEventLogsOlderThan(days);
    if (deleted > 0) {
      console.log(`[event-log-cleanup] deleted ${deleted} row(s) older than ${days} day(s)`);
    }
  }

  stop() {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }
}
