import TelegramBot from 'node-telegram-bot-api';
import { agentQuery as query } from '../db/pool.js';
import {
  loadSession,
  ensureSession,
  appendMessage,
  resetSession,
  findActiveTelegramSession,
} from '../db/sessions.js';
import { listJobs, getJob, deleteJob } from '../db/crons.js';
import { enqueue as enqueueMessage, claimBatch } from '../db/queue.js';
import { reloadCronJobs } from '../cron/runner.js';
import { withSessionLock } from '../lib/sessionLock.js';
import config from '../config.js';

const MAX_MSG_LEN = 4096;

export class TelegramManager {
  #agent;
  #expressApp;
  #bots = new Map(); // channel.id -> TelegramBot

  constructor(agent) {
    this.#agent = agent;
  }

  async start(expressApp) {
    this.#expressApp = expressApp;
    await this.reload();
  }

  async reload() {
    for (const bot of this.#bots.values()) {
      try { await bot.stopPolling(); } catch {}
    }
    this.#bots.clear();

    let channels = [];
    try {
      const result = await query(`
        SELECT c.*, a.name as agent_name, a.system_prompt,
               m.base_url, m.model_id, m.think, m.accepts, m.provider, m.api_key
        FROM channels c
        JOIN agents a ON c.agent_id = a.id
        LEFT JOIN models m ON a.model_id = m.id
        WHERE c.type = 'telegram' AND c.enabled = true
      `);
      channels = result.rows;
    } catch (err) {
      console.error(`[telegram] Failed to load channels: ${err.message}`);
      return;
    }

    if (channels.length === 0) {
      console.log('[telegram] No enabled channels');
      return;
    }

    for (const channel of channels) {
      await this.#startBot(channel);
    }
  }

  async #startBot(channel) {
    const botToken = channel.config?.token;
    if (!botToken) { console.error(`[telegram] ${channel.name}: no token in config`); return; }

    const allowedUsers = channel.config?.allowed_users || [];
    const isPolling = config.telegram.mode === 'polling';

    const bot = new TelegramBot(botToken, { polling: isPolling });

    bot.on('polling_error', (err) => {
      console.error(`[telegram] ${channel.name} polling error: ${err.message}`);
    });

    bot.on('error', (err) => {
      console.error(`[telegram] ${channel.name} error: ${err.message}`);
    });

    if (!isPolling && config.telegram.webhookUrl && this.#expressApp) {
      const path = `/webhook/${channel.name}`;
      const url = `${config.telegram.webhookUrl}${path}`;
      await bot.setWebHook(url);
      this.#expressApp.post(path, (req, res) => {
        bot.processUpdate(req.body);
        res.sendStatus(200);
      });
      console.log(`[telegram] ${channel.name}: webhook at ${url}`);
    } else {
      console.log(`[telegram] ${channel.name}: polling`);
    }

    bot.on('message', async (msg) => {
      console.log(`[telegram] ${channel.name}: message from ${msg.from.id}: ${(msg.text || '(media)').slice(0, 50)}`);

      if (allowedUsers.length > 0 && !allowedUsers.includes(msg.from.id)) {
        console.log(`[telegram] ${channel.name}: user ${msg.from.id} not in allowlist`);
        return;
      }

      if (msg.text === '/start') {
        return bot.sendMessage(msg.chat.id, `Hi! I'm DogeClaw (${channel.agent_name}). Commands:\n/new - Start a new chat\n/reset - Clear current chat\n/cron - List scheduled jobs (use /cron rm <id> to delete)`);
      }
      if (msg.text === '/reset') {
        const sid = await this.#resolveSessionId(channel, msg.chat.id);
        await ensureSession(sid, this.#sessionMeta(channel, msg.chat.id));
        await resetSession(sid);
        return bot.sendMessage(msg.chat.id, 'Conversation reset.');
      }
      if (msg.text === '/new') {
        const newSid = `tg-${channel.name}-${msg.chat.id}-${Date.now()}`;
        await ensureSession(newSid, this.#sessionMeta(channel, msg.chat.id));
        return bot.sendMessage(msg.chat.id, 'New chat started. Previous chat is still visible in the web UI.');
      }
      if (msg.text === '/cron' || msg.text?.startsWith('/cron ')) {
        return this.#handleCronCommand(bot, msg, channel);
      }

      let images = null;
      let textContent = msg.text || '';

      if (msg.photo) {
        const photo = msg.photo[msg.photo.length - 1];
        try {
          images = [await this.#downloadFileBase64(bot, photo.file_id)];
          textContent = msg.caption || 'What do you see in this image?';
        } catch (err) {
          console.error(`[telegram] ${channel.name}: failed to download photo: ${err.message}`);
        }
      } else if (msg.document && msg.document.mime_type?.startsWith('image/')) {
        try {
          images = [await this.#downloadFileBase64(bot, msg.document.file_id)];
          textContent = msg.caption || 'What do you see in this image?';
        } catch (err) {
          console.error(`[telegram] ${channel.name}: failed to download document: ${err.message}`);
        }
      } else if (msg.voice || msg.audio) {
        const fileId = (msg.voice || msg.audio).file_id;
        const mime = (msg.voice || msg.audio).mime_type || 'audio/ogg';
        try {
          console.log(`[telegram] ${channel.name}: downloading audio...`);
          bot.sendChatAction(msg.chat.id, 'typing').catch(() => {});
          const audioB64 = await this.#downloadFileBase64(bot, fileId);
          textContent = msg.caption || '';

          // Transcribe upfront in BOTH modes so we get a single audit trail
          // (one event_logs row per voice message) and so audio-capable models
          // and non-audio models share the same logged transcript that the
          // admin UI links back to the session message.
          const { transcribeAndLog } = await import('../audio.js');
          const sessionId = await this.#resolveSessionId(channel, msg.chat.id);
          const tr = await transcribeAndLog(audioB64, mime, {
            refId: sessionId,
            meta: {
              channel_id: channel.id,
              channel_name: channel.name,
              chat_id: String(msg.chat.id),
              telegram_message_id: msg.message_id,
              session_id: sessionId,
            },
          });
          const transcript = tr.text;
          const transcriptionEventId = tr.eventLogId;

          if (channel.response_mode === 'periodic') {
            await this.#enqueue(channel.id, msg, transcript, images);
            return;
          }
          await this.#handleMessage(bot, msg.chat.id, textContent, images, channel, {
            audioB64,
            audioMime: mime,
            transcript,
            transcriptionEventId,
            telegramMessageId: msg.message_id,
          });
          return;
        } catch (err) {
          console.error(`[telegram] ${channel.name}: failed to handle audio: ${err.message}`);
          await bot.sendMessage(msg.chat.id, `Failed to process audio: ${err.message}`).catch(() => {});
          return;
        }
      }

      if (!textContent && !images) return;

      if (channel.response_mode === 'periodic') {
        await this.#enqueue(channel.id, msg, textContent, images);
        return;
      }

      await this.#handleMessage(bot, msg.chat.id, textContent, images, channel);
    });

    this.#bots.set(channel.id, bot);

    if (channel.response_mode === 'periodic' && channel.response_interval) {
      const ms = parseInterval(channel.response_interval);
      if (ms > 0) {
        const timer = setInterval(() => this.#processQueue(channel), ms);
        // Track the timer alongside the bot so stop() can clear it.
        bot.__periodicTimer = timer;
        console.log(`[telegram] ${channel.name}: periodic every ${channel.response_interval}`);
      }
    }
  }

  async #downloadFileBase64(bot, fileId) {
    const file = await bot.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
    const res = await fetch(url);
    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer.toString('base64');
  }

  #sessionMeta(channel, chatId) {
    return {
      agentId: channel.agent_id,
      agentName: channel.agent_name,
      source: 'telegram',
      channelId: channel.id,
      channelName: channel.name,
      chatId: String(chatId),
    };
  }

  async #resolveSessionId(channel, chatId) {
    const existing = await findActiveTelegramSession(channel.id, chatId);
    return existing || `tg-${channel.name}-${chatId}`;
  }

  async #handleMessage(bot, chatId, text, images, channel, audio = null) {
    bot.sendChatAction(chatId, 'typing').catch(() => {});

    const sessionId = await this.#resolveSessionId(channel, chatId);
    await ensureSession(sessionId, this.#sessionMeta(channel, chatId));

    const modelConfig = {
      base_url: channel.base_url,
      model_id: channel.model_id,
      think: channel.think,
      accepts: channel.accepts || ['text'],
      provider: channel.provider || 'ollama',
      apiKey: channel.api_key,
    };

    await withSessionLock(sessionId, async () => {
      try {
        const { messages: history } = await loadSession(sessionId);

        const result = await this.#agent.run(text, history, {
          agentId: channel.agent_id,
          channelId: channel.id,
          chatId: String(chatId),
          sessionId,
          systemPrompt: channel?.system_prompt,
          modelConfig,
          images: images || undefined,
          audio: audio?.audioB64 || undefined,
          audioMime: audio?.audioMime || undefined,
          audioTranscript: audio?.transcript || undefined,
        });

        const userMeta = {};
        if (audio) {
          userMeta.telegram_message_id = audio.telegramMessageId;
          userMeta.transcript = audio.transcript;
          userMeta.transcription_event_id = audio.transcriptionEventId;
        }

        await appendMessage(sessionId, {
          role: 'user',
          content: text || (audio?.transcript || ''),
          hasImage: !!images?.length,
          hasAudio: !!audio,
          meta: userMeta,
        });
        await appendMessage(sessionId, {
          role: 'assistant',
          content: result.content,
          toolCalls: result.toolCalls?.length ? result.toolCalls : null,
        });

        await sendLong(bot, chatId, result.content);
      } catch (err) {
        console.error(`[telegram] Error handling message: ${err.message}`);
        await bot.sendMessage(chatId, `Error: ${err.message}`).catch(() => {});
      }
    });
  }

  async #handleCronCommand(bot, msg, channel) {
    const parts = msg.text.trim().split(/\s+/);
    const chatId = String(msg.chat.id);

    if (parts.length === 1) {
      const all = await listJobs();
      const mine = all.filter(j => j.channel_id === channel.id && j.chat_id === chatId);
      if (!mine.length) {
        return bot.sendMessage(msg.chat.id, 'No scheduled jobs for this chat.');
      }
      const lines = mine.map(j => {
        const sched = j.expression ? `cron \`${j.expression}\`` : `at ${new Date(j.run_at).toISOString()}`;
        const last = j.last_run_at
          ? ` (last: ${j.last_status} ${new Date(j.last_run_at).toISOString()})`
          : '';
        const desc = j.description ? ` — ${j.description}` : '';
        return `#${j.id}: ${sched}${desc}${last}\n  prompt: ${(j.prompt || '').slice(0, 80)}`;
      });
      return bot.sendMessage(msg.chat.id, `Scheduled jobs:\n${lines.join('\n\n')}`);
    }

    if (parts[1] === 'rm' && parts[2]) {
      const id = parseInt(parts[2], 10);
      if (Number.isNaN(id)) return bot.sendMessage(msg.chat.id, 'Usage: /cron rm <id>');
      const job = await getJob(id);
      if (!job) return bot.sendMessage(msg.chat.id, `Job #${id} not found.`);
      if (job.channel_id !== channel.id || job.chat_id !== chatId) {
        return bot.sendMessage(msg.chat.id, `Job #${id} is not in this chat.`);
      }
      await deleteJob(id);
      await reloadCronJobs();
      return bot.sendMessage(msg.chat.id, `Removed job #${id}.`);
    }

    return bot.sendMessage(msg.chat.id, 'Usage:\n/cron — list jobs in this chat\n/cron rm <id> — delete a job');
  }

  async #enqueue(channelId, msg, text, images) {
    await enqueueMessage(channelId, {
      chatId: msg.chat.id,
      userId: msg.from?.id,
      text,
      images,
    });
  }

  async #processQueue(channel) {
    const bot = this.#bots.get(channel.id);
    if (!bot) return;

    const items = await claimBatch(channel.id);
    if (!items.length) return;

    const byChat = new Map();
    for (const item of items) {
      if (!byChat.has(item.chat_id)) byChat.set(item.chat_id, []);
      byChat.get(item.chat_id).push(item);
    }

    for (const [chatId, messages] of byChat) {
      const combined = messages.map(m => m.text).join('\n---\n');
      try {
        const result = await this.#agent.run(combined, [], {
          agentId: channel.agent_id,
          channelId: channel.id,
          chatId: String(chatId),
          systemPrompt: channel.system_prompt,
          modelConfig: { base_url: channel.base_url, model_id: channel.model_id, think: channel.think, accepts: channel.accepts || ['text'], provider: channel.provider || 'ollama', apiKey: channel.api_key },
          systemNote: `Processing ${messages.length} queued message(s)`,
        });
        await sendLong(bot, chatId, result.content);
      } catch (err) {
        await bot.sendMessage(chatId, `Error: ${err.message}`).catch(() => {});
      }
    }
  }

  async sendMessageVia(channelId, chatId, text) {
    const bot = this.#bots.get(channelId);
    if (!bot) throw new Error(`no telegram bot for channel ${channelId}`);
    await sendLong(bot, chatId, text);
  }

  stop() {
    for (const bot of this.#bots.values()) {
      try { bot.stopPolling(); } catch {}
      if (bot.__periodicTimer) clearInterval(bot.__periodicTimer);
    }
    this.#bots.clear();
  }
}

async function sendLong(bot, chatId, text) {
  if (!text) return;
  if (text.length <= MAX_MSG_LEN) return bot.sendMessage(chatId, text);
  let remaining = text;
  while (remaining.length > 0) {
    let chunk = remaining.slice(0, MAX_MSG_LEN);
    if (remaining.length > MAX_MSG_LEN) {
      const nl = chunk.lastIndexOf('\n');
      if (nl > MAX_MSG_LEN / 2) chunk = chunk.slice(0, nl);
    }
    await bot.sendMessage(chatId, chunk);
    remaining = remaining.slice(chunk.length);
  }
}

function parseInterval(str) {
  const match = str?.match(/^(\d+)\s*(m|h|s)$/);
  if (!match) return 0;
  const num = parseInt(match[1], 10);
  if (match[2] === 's') return num * 1000;
  if (match[2] === 'm') return num * 60000;
  if (match[2] === 'h') return num * 3600000;
  return 0;
}
