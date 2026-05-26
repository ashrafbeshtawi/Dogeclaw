// One-shot importer for pre-DB legacy data:
//   - ${workspace}/cron.json  → cron_jobs table
//   - ${workspace}/sessions/*.json → sessions + session_messages tables
//
// Runs on every boot but no-ops once the target tables are non-empty or the
// source files have been renamed to *.imported. Safe to keep around.

import { readFile, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import config from '../config.js';
import { adminQuery } from '../db/pool.js';
import { createJob } from '../db/crons.js';
import { ensureSession, appendMessage } from '../db/sessions.js';
import { enqueue } from '../db/queue.js';

export async function importLegacyData() {
  await importCron().catch(err => console.error('[import] cron:', err.message));
  await importSessions().catch(err => console.error('[import] sessions:', err.message));
  await importQueues().catch(err => console.error('[import] queues:', err.message));
}

async function importCron() {
  const path = config.paths.cronFile;
  let raw;
  try {
    raw = await readFile(path, 'utf-8');
  } catch {
    return; // No legacy file — nothing to do.
  }

  const countRes = await adminQuery('SELECT COUNT(*)::int AS n FROM cron_jobs');
  if (countRes.rows[0].n > 0) {
    console.log('[import] cron_jobs already populated, leaving cron.json in place');
    return;
  }

  let data;
  try { data = JSON.parse(raw); }
  catch (err) {
    console.error(`[import] cron.json is not valid JSON: ${err.message}`);
    return;
  }

  const jobs = data.jobs || [];
  if (!jobs.length) {
    await rename(path, `${path}.imported`).catch(() => {});
    return;
  }

  const chRes = await adminQuery(
    `SELECT id, name FROM channels WHERE type='telegram' AND enabled ORDER BY id LIMIT 1`,
  );
  const defaultChannel = chRes.rows[0] || null;

  let imported = 0;
  let skipped = 0;
  for (const j of jobs) {
    try {
      if (!j.expression || !j.prompt) { skipped++; continue; }
      if (j.notifyChat == null || !defaultChannel) { skipped++; continue; }
      await createJob({
        agentId: j.agentId || 1,
        channelId: defaultChannel.id,
        chatId: String(j.notifyChat),
        expression: j.expression,
        timezone: 'UTC',
        description: j.description || '',
        prompt: j.prompt,
        enabled: j.enabled !== false,
      });
      imported++;
    } catch (err) {
      console.error(`[import] failed to import cron job ${j.id}: ${err.message}`);
      skipped++;
    }
  }
  console.log(`[import] cron: imported ${imported}, skipped ${skipped}`);
  await rename(path, `${path}.imported`).catch(() => {});
}

async function importSessions() {
  const dir = config.paths.sessions;
  let entries;
  try { entries = await readdir(dir); }
  catch { return; }
  const files = entries.filter(f => f.endsWith('.json'));
  if (!files.length) return;

  const countRes = await adminQuery('SELECT COUNT(*)::int AS n FROM sessions');
  if (countRes.rows[0].n > 0) {
    console.log('[import] sessions table already populated, leaving session files in place');
    return;
  }

  const chRes = await adminQuery(`SELECT id, name FROM channels WHERE type='telegram'`);
  const channelByName = new Map(chRes.rows.map(c => [c.name, c]));

  let imported = 0;
  let skipped = 0;
  for (const f of files) {
    const fullPath = join(dir, f);
    try {
      const data = JSON.parse(await readFile(fullPath, 'utf-8'));
      const id = f.replace(/\.json$/, '');
      const isTelegram = data.source === 'telegram' || id.startsWith('tg-');

      let chatId = null;
      let channelRow = null;
      if (isTelegram) {
        const channelName = data.channel;
        if (channelName) {
          channelRow = channelByName.get(channelName) || null;
          const prefix = `tg-${channelName}-`;
          if (id.startsWith(prefix)) {
            chatId = id.slice(prefix.length).replace(/-\d+$/, '');
          }
        }
      }

      await ensureSession(id, {
        agentId: data.agentId || null,
        agentName: data.agentName || null,
        source: isTelegram ? 'telegram' : 'web',
        channelId: channelRow?.id || null,
        channelName: channelRow?.name || data.channel || null,
        chatId,
      });

      for (const m of (data.messages || [])) {
        await appendMessage(id, {
          role: m.role,
          content: m.content || '',
          toolCalls: m.toolCalls || null,
          thinking: m.thinking || null,
          hasImage: !!m.hasImage,
          hasAudio: !!m.hasAudio,
        });
      }
      imported++;
    } catch (err) {
      console.error(`[import] session ${f}: ${err.message}`);
      skipped++;
    }
  }
  console.log(`[import] sessions: imported ${imported}, skipped ${skipped}`);

  try {
    await rename(dir, `${dir}.imported`);
  } catch (err) {
    console.error(`[import] couldn't rename sessions dir: ${err.message}`);
  }
}

async function importQueues() {
  const dir = config.paths.queues;
  let entries;
  try { entries = await readdir(dir); }
  catch { return; }
  const files = entries.filter(f => f.endsWith('.json'));
  if (!files.length) return;

  const countRes = await adminQuery('SELECT COUNT(*)::int AS n FROM queued_messages');
  if (countRes.rows[0].n > 0) {
    console.log('[import] queued_messages already populated, leaving queue files in place');
    return;
  }

  const chRes = await adminQuery(`SELECT id, name FROM channels`);
  const channelByName = new Map(chRes.rows.map(c => [c.name, c]));

  let imported = 0;
  let skipped = 0;
  for (const f of files) {
    const channelName = f.replace(/\.json$/, '');
    const channel = channelByName.get(channelName);
    if (!channel) {
      console.warn(`[import] queue ${f}: channel "${channelName}" not found`);
      skipped++;
      continue;
    }
    try {
      const raw = await readFile(join(dir, f), 'utf-8');
      const items = JSON.parse(raw);
      if (!Array.isArray(items)) { skipped++; continue; }
      for (const it of items) {
        if (it.chatId == null) { skipped++; continue; }
        await enqueue(channel.id, {
          chatId: it.chatId,
          userId: it.from,
          text: it.text || '',
          images: it.images || null,
        });
        imported++;
      }
    } catch (err) {
      console.error(`[import] queue ${f}: ${err.message}`);
      skipped++;
    }
  }
  console.log(`[import] queues: imported ${imported}, skipped ${skipped}`);

  try {
    await rename(dir, `${dir}.imported`);
  } catch (err) {
    console.error(`[import] couldn't rename queues dir: ${err.message}`);
  }
}
