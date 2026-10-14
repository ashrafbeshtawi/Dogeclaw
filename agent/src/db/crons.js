import { CronExpressionParser } from 'cron-parser';
import { adminQuery } from './pool.js';

// The one shape a cron job has outside this file. Every query here returns
// rows through toJob, and the table's CHECK constraints (V5__cron_jobs.sql)
// guarantee exactly one schedule and exactly one target per row:
//
//   { id, agentId, agentName, prompt, description, timezone, enabled,
//     schedule: { kind: 'recurring', expression } | { kind: 'oneShot', runAt },
//     target:   { kind: 'telegram', channelId, channelName, chatId }
//             | { kind: 'session', sessionId },
//     nextRunAt, runCount, lastRunAt, lastStatus, lastError, createdAt, updatedAt }
function toJob(row) {
  return {
    id: row.id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    prompt: row.prompt,
    description: row.description,
    timezone: row.timezone,
    enabled: row.enabled,
    schedule: row.run_at
      ? { kind: 'oneShot', runAt: row.run_at }
      : { kind: 'recurring', expression: row.expression },
    target: row.chat_id
      ? { kind: 'telegram', channelId: row.channel_id, channelName: row.channel_name, chatId: row.chat_id }
      : { kind: 'session', sessionId: row.session_id },
    nextRunAt: row.next_run_at,
    runCount: row.run_count,
    lastRunAt: row.last_run_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// The flat snake_case form the HTTP API and the admin UI speak, matching the
// request bodies they send.
export function toJobResponse(job) {
  const { schedule, target } = job;
  return {
    id: job.id,
    agent_id: job.agentId,
    agent_name: job.agentName,
    channel_id: target.kind === 'telegram' ? target.channelId : null,
    channel_name: target.kind === 'telegram' ? target.channelName : null,
    chat_id: target.kind === 'telegram' ? target.chatId : null,
    session_id: target.kind === 'session' ? target.sessionId : null,
    expression: schedule.kind === 'recurring' ? schedule.expression : null,
    run_at: schedule.kind === 'oneShot' ? schedule.runAt : null,
    timezone: job.timezone,
    description: job.description,
    prompt: job.prompt,
    enabled: job.enabled,
    next_run_at: job.nextRunAt,
    run_count: job.runCount,
    last_run_at: job.lastRunAt,
    last_status: job.lastStatus,
    last_error: job.lastError,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
  };
}

// `source` is cron_jobs itself or a CTE over it (a write's RETURNING *), so
// reads and writes all come back with the agent and channel names.
function selectJobsFrom(source) {
  return `SELECT j.*, a.name AS agent_name, c.name AS channel_name
            FROM ${source} j
            LEFT JOIN agents   a ON j.agent_id   = a.id
            LEFT JOIN channels c ON j.channel_id = c.id`;
}

async function queryJobs(sql, values) {
  const res = await adminQuery(sql, values);
  return res.rows.map(toJob);
}

// The next time a recurring job is due strictly after `from`, in the job's
// timezone. Throws on an invalid expression or timezone.
export function computeNextCronRun(expression, timezone, from) {
  return CronExpressionParser.parse(expression, { tz: timezone, currentDate: from }).next().toDate();
}

// cron-parser fills missing fields with defaults, so "0 10 * *" would parse;
// only the 5-field form and the 6-field form with seconds are accepted.
function isValidCronExpression(expression, timezone) {
  const fieldCount = expression.trim().split(/\s+/).length;
  if (fieldCount !== 5 && fieldCount !== 6) return false;
  try {
    computeNextCronRun(expression, timezone, new Date());
    return true;
  } catch {
    return false;
  }
}

// Empty strings from forms and tool calls mean "not set".
function toNullable(value) {
  return value === undefined || value === null || value === '' ? null : value;
}

function validateSchedule({ expression, runAt, timezone }) {
  if ((expression === null) === (runAt === null)) return 'exactly one of expression or run_at is required';
  if (expression !== null && !isValidCronExpression(expression, timezone)) {
    return `invalid cron expression or timezone: ${expression} (${timezone})`;
  }
  if (runAt !== null && isNaN(new Date(runAt).getTime())) return `invalid run_at: ${runAt}`;
  return null;
}

function validateTarget({ channelId, chatId, sessionId }) {
  if ((chatId === null) === (sessionId === null)) return 'exactly one of (channel_id+chat_id) or session_id is required';
  if (chatId !== null && channelId === null) return 'channel_id is required when chat_id is set';
  return null;
}

// Normalizes and validates createJob input once, so everything after works
// on a complete object with nulls instead of empty strings.
function parseJobInput(input) {
  const chatId = toNullable(input.chatId);
  const job = {
    agentId: toNullable(input.agentId),
    channelId: toNullable(input.channelId),
    chatId: chatId === null ? null : String(chatId),
    sessionId: toNullable(input.sessionId),
    expression: toNullable(input.expression),
    runAt: toNullable(input.runAt),
    timezone: toNullable(input.timezone) ?? 'UTC',
    description: input.description || '',
    prompt: toNullable(input.prompt),
    enabled: input.enabled !== false,
  };
  const err = validateSchedule(job) || validateTarget(job);
  if (err) throw new Error(err);
  if (job.agentId === null) throw new Error('agent_id is required');
  if (job.prompt === null) throw new Error('prompt is required');
  return job;
}

export async function listJobs() {
  return queryJobs(`${selectJobsFrom('cron_jobs')} ORDER BY j.id DESC`);
}

export async function getJob(id) {
  const [job] = await queryJobs(`${selectJobsFrom('cron_jobs')} WHERE j.id = $1`, [id]);
  return job || null;
}

export async function createJob(input) {
  const job = parseJobInput(input);
  const [created] = await queryJobs(
    `WITH inserted AS (
       INSERT INTO cron_jobs
         (agent_id, channel_id, chat_id, session_id, expression, run_at,
          timezone, description, prompt, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *
     )
     ${selectJobsFrom('inserted')}`,
    [
      job.agentId, job.channelId, job.chatId, job.sessionId, job.expression,
      job.runAt, job.timezone, job.description, job.prompt, job.enabled,
    ],
  );
  return created;
}

// `patch` fields left undefined keep their current value.
export async function updateJob(id, patch) {
  const current = await getJob(id);
  if (!current) return null;

  const changes = {
    expression: patch.expression === undefined ? undefined : toNullable(patch.expression),
    run_at:     patch.runAt      === undefined ? undefined : toNullable(patch.runAt),
    timezone:   patch.timezone   === undefined ? undefined : toNullable(patch.timezone) ?? 'UTC',
    description: patch.description,
    prompt:      patch.prompt,
    enabled:     patch.enabled,
  };
  const err = validateSchedule({
    expression: changes.expression !== undefined ? changes.expression : current.schedule.expression ?? null,
    runAt:      changes.run_at     !== undefined ? changes.run_at     : current.schedule.runAt ?? null,
    timezone:   changes.timezone   ?? current.timezone,
  });
  if (err) throw new Error(err);

  const sets = [];
  const values = [];
  for (const [col, val] of Object.entries(changes)) {
    if (val === undefined) continue;
    values.push(val);
    sets.push(`${col} = $${values.length}`);
  }
  if (!sets.length) return current;
  // Any change hands the job back to the runner to plan its next run from
  // the new updated_at (see planUnscheduledJobs).
  sets.push(`next_run_at = NULL`, `updated_at = NOW()`);
  values.push(id);
  const [updated] = await queryJobs(
    `WITH updated AS (
       UPDATE cron_jobs SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *
     )
     ${selectJobsFrom('updated')}`,
    values,
  );
  return updated || null;
}

export async function deleteJob(id) {
  const res = await adminQuery(`DELETE FROM cron_jobs WHERE id = $1`, [id]);
  return res.rowCount > 0;
}

export async function recordRun(id, { status, error }) {
  await adminQuery(
    `UPDATE cron_jobs
        SET last_run_at = NOW(),
            last_status = $1,
            last_error  = $2,
            run_count   = run_count + 1,
            updated_at  = NOW()
      WHERE id = $3`,
    [status, error || null, id],
  );
}

// Scheduling: next_run_at is the single source of truth for when a job runs.
// NULL means "not planned yet" — new jobs, edited jobs, and rows from before
// the column existed. The runner plans those, then claims due runs one row at
// a time; see src/cron/runner.js.

export async function findUnscheduledJobs() {
  return queryJobs(`${selectJobsFrom('cron_jobs')} WHERE j.enabled AND j.next_run_at IS NULL`);
}

// The updated_at guard keeps a plan computed from a stale row from landing
// on top of an edit that happened in between; that edit gets planned on the
// next tick instead. updated_at holds microseconds and the JS Date read back
// only milliseconds, hence the truncation. next_run_at itself is only ever
// written from JS Dates, so it holds milliseconds and claimDueRun can match
// it exactly.
export async function planNextRun(job, nextRunAt) {
  await adminQuery(
    `UPDATE cron_jobs SET next_run_at = $1
      WHERE id = $2 AND next_run_at IS NULL
        AND date_trunc('milliseconds', updated_at) = $3`,
    [nextRunAt, job.id, job.updatedAt],
  );
}

export async function findDueJobs() {
  return queryJobs(`${selectJobsFrom('cron_jobs')} WHERE j.enabled AND j.next_run_at <= NOW()`);
}

// Atomically takes ownership of one due run: only the caller whose UPDATE
// still sees the next_run_at it read gets the job back, so a run can never be
// started twice — not by an overlapping tick, not by a second instance. A
// one-shot is disabled in the same statement; a recurring job moves on to
// nextRunAt.
export async function claimDueRun(job, nextRunAt) {
  const [claimed] = await queryJobs(
    `WITH claimed AS (
       UPDATE cron_jobs
          SET next_run_at = $1,
              enabled     = enabled AND run_at IS NULL
        WHERE id = $2 AND enabled AND next_run_at = $3
        RETURNING *
     )
     ${selectJobsFrom('claimed')}`,
    [nextRunAt, job.id, job.nextRunAt],
  );
  return claimed || null;
}
