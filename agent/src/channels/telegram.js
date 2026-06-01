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

// Slash commands the bot supports. Registered with Telegram on every bot
// start via `bot.setMyCommands` so the official client shows them in the
// `/` menu. The /start greeting is generated from this same list so both
// surfaces stay in sync. Descriptions must be ≤ 256 chars per the Bot API.
export const BOT_COMMANDS = [
  { command: 'start', description: 'Show the greeting and available commands' },
  { command: 'new',   description: 'Start a fresh conversation' },
  { command: 'reset', description: 'Clear the current conversation' },
  { command: 'cron',  description: 'List scheduled jobs (use /cron rm <id> to remove one)' },
];

export class TelegramManager {
  #agent;
  #expressApp;
  #bots = new Map();         // channel.id -> TelegramBot
  // Single source of truth for channel/agent/model config keyed by channel.id.
  // The bot's message handler closure looks this up on every message so that
  // mutating the agent (e.g. swapping its model in the admin UI) takes effect
  // immediately — the captured `channel` parameter is just an initial seed.
  // Without this, `node-telegram-bot-api`'s `stopPolling()` not fully halting
  // an in-flight long poll meant the OLD bot's handler could fire against
  // stale Gemini config even after a reload pointed the agent at DeepSeek.
  #channelById = new Map();  // channel.id -> joined channel row

  constructor(agent) {
    this.#agent = agent;
  }

  async start(expressApp) {
    this.#expressApp = expressApp;
    await this.reload();
  }

  // Returns the current joined channel config the manager has for `id`,
  // or null if no bot is registered for it. Used by tests / debug endpoints
  // to verify reload picked up model changes.
  getChannelView(id) {
    const c = this.#channelById.get(Number(id));
    return c ? { ...c } : null;
  }

  async reload() {
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

    // Refresh the channel-by-id map FIRST. Any in-flight handler from an
    // old bot will pick up the new config on its next message lookup,
    // even before we've finished stopping/restarting bots.
    const freshById = new Map(channels.map(c => [c.id, c]));
    this.#channelById = freshById;

    // Stop bots whose channel is gone or whose bot token changed.
    for (const [id, bot] of [...this.#bots]) {
      const fresh = freshById.get(id);
      if (!fresh || fresh.config?.token !== bot.__channelToken) {
        try { await bot.stopPolling(); } catch {}
        if (bot.__periodicTimer) clearInterval(bot.__periodicTimer);
        this.#bots.delete(id);
      }
    }

    if (channels.length === 0) {
      console.log('[telegram] No enabled channels');
      return;
    }

    // Start bots for channels that don't have one yet. Existing bots whose
    // token is unchanged keep running — their message handlers will look up
    // the fresh config from #channelById on the next message.
    for (const channel of channels) {
      if (!this.#bots.has(channel.id)) {
        await this.#startBot(channel);
      } else {
        // Reset the periodic timer if its interval changed, so the new
        // cadence takes effect without restarting the bot itself.
        const existing = this.#bots.get(channel.id);
        if (existing.__periodicInterval !== channel.response_interval) {
          if (existing.__periodicTimer) clearInterval(existing.__periodicTimer);
          existing.__periodicTimer = null;
          existing.__periodicInterval = null;
          this.#armPeriodicTimer(existing, channel);
        }
      }
    }
  }

  async #startBot(channel) {
    const botToken = channel.config?.token;
    if (!botToken) { console.error(`[telegram] ${channel.name}: no token in config`); return; }

    const channelId = channel.id;
    const isPolling = config.telegram.mode === 'polling';

    const bot = new TelegramBot(botToken, { polling: isPolling });
    bot.__channelToken = botToken; // remembered by reload() to detect token rotations

    bot.on('polling_error', (err) => {
      const name = this.#channelById.get(channelId)?.name || channel.name;
      console.error(`[telegram] ${name} polling error: ${err.message}`);
    });

    bot.on('error', (err) => {
      const name = this.#channelById.get(channelId)?.name || channel.name;
      console.error(`[telegram] ${name} error: ${err.message}`);
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
      // Look up the LIVE channel config on every message. This is what makes
      // model swaps in the admin UI take effect without restarting the bot.
      const current = this.#channelById.get(channelId) || channel;
      const allowedUsers = current.config?.allowed_users || [];

      console.log(`[telegram] ${current.name}: message from ${msg.from.id}: ${(msg.text || '(media)').slice(0, 50)}`);

      if (allowedUsers.length > 0 && !allowedUsers.includes(msg.from.id)) {
        console.log(`[telegram] ${current.name}: user ${msg.from.id} not in allowlist`);
        return;
      }

      if (msg.text === '/start') {
        const lines = BOT_COMMANDS
          .filter(c => c.command !== 'start') // greeting already covers it
          .map(c => `/${c.command} - ${c.description}`);
        return bot.sendMessage(
          msg.chat.id,
          `Hi! I'm DogeClaw (${current.agent_name}). Commands:\n${lines.join('\n')}`,
        );
      }
      if (msg.text === '/reset') {
        const sid = await this.#resolveSessionId(current, msg.chat.id);
        await ensureSession(sid, this.#sessionMeta(current, msg.chat.id));
        await resetSession(sid);
        return bot.sendMessage(msg.chat.id, 'Conversation reset.');
      }
      if (msg.text === '/new') {
        const newSid = `tg-${current.name}-${msg.chat.id}-${Date.now()}`;
        await ensureSession(newSid, this.#sessionMeta(current, msg.chat.id));
        return bot.sendMessage(msg.chat.id, 'New chat started. Previous chat is still visible in the web UI.');
      }
      if (msg.text === '/cron' || msg.text?.startsWith('/cron ')) {
        return this.#handleCronCommand(bot, msg, current);
      }

      // Media routing: download only what the model can actually consume.
      // Anything the model doesn't accept becomes a [Attached: <type>] hint
      // so the model can at least acknowledge it to the user.
      const accepts = Array.isArray(current.accepts) ? current.accepts : ['text'];
      let textContent = msg.text || msg.caption || '';
      const media = { images: null, audio: null, audioMime: null, video: null, videoMime: null };
      const mediaHints = [];

      try {
        // Photos / image-as-document
        const imageFileId = msg.photo
          ? msg.photo[msg.photo.length - 1].file_id
          : (msg.document?.mime_type?.startsWith('image/') ? msg.document.file_id : null);
        if (imageFileId) {
          if (accepts.includes('image')) {
            media.images = [await this.#downloadFileBase64(bot, imageFileId)];
          } else {
            mediaHints.push('image');
          }
        }

        // Voice notes + audio files
        const audioPart = msg.voice || msg.audio;
        if (audioPart) {
          bot.sendChatAction(msg.chat.id, 'typing').catch(() => {});
          if (accepts.includes('audio')) {
            console.log(`[telegram] ${current.name}: downloading audio for audio-capable model...`);
            media.audio = await this.#downloadFileBase64(bot, audioPart.file_id);
            media.audioMime = audioPart.mime_type || 'audio/ogg';
          } else {
            mediaHints.push('audio');
          }
        }

        // Videos + video notes (round Telegram bubbles)
        const videoPart = msg.video || msg.video_note;
        if (videoPart) {
          if (accepts.includes('video')) {
            console.log(`[telegram] ${current.name}: downloading video for video-capable model...`);
            media.video = await this.#downloadFileBase64(bot, videoPart.file_id);
            media.videoMime = videoPart.mime_type || 'video/mp4';
          } else {
            mediaHints.push('video');
          }
        }
      } catch (err) {
        console.error(`[telegram] ${current.name}: failed to download media: ${err.message}`);
        await bot.sendMessage(msg.chat.id, `Failed to process attachment: ${err.message}`).catch(() => {});
        return;
      }

      const hasAnything = textContent || media.images || media.audio || media.video || mediaHints.length;
      if (!hasAnything) return;

      if (current.response_mode === 'periodic') {
        // The queue table only carries text + images. Audio/video bytes are
        // dropped on this path; bake any media we won't be forwarding into
        // the stored text as [Attached: X] hints so the batched run still
        // knows the user attached something.
        const queueHints = new Set(mediaHints);
        if (media.audio) queueHints.add('audio');
        if (media.video) queueHints.add('video');
        const queueText = queueHints.size
          ? [textContent, [...queueHints].map(t => `[Attached: ${t}]`).join(' ')].filter(Boolean).join('\n')
          : textContent;
        await this.#enqueue(current.id, msg, queueText, media.images);
        return;
      }

      await this.#handleMessage(bot, msg.chat.id, textContent, media, mediaHints, current, msg.message_id);
    });

    this.#bots.set(channelId, bot);
    this.#armPeriodicTimer(bot, channel);

    // Tell Telegram about our slash commands so the official client renders
    // the `/` menu. Fire-and-forget — if Telegram is unreachable we still
    // want the bot to come up (the commands list is cosmetic).
    bot.setMyCommands(BOT_COMMANDS).then(() => {
      console.log(`[telegram] ${channel.name}: registered ${BOT_COMMANDS.length} bot commands`);
    }).catch(err => {
      console.error(`[telegram] ${channel.name}: setMyCommands failed: ${err.message}`);
    });
  }

  #armPeriodicTimer(bot, channel) {
    if (channel.response_mode !== 'periodic' || !channel.response_interval) return;
    const ms = parseInterval(channel.response_interval);
    if (ms <= 0) return;
    const channelId = channel.id;
    // Look up fresh channel data each tick so an interval/agent/model change
    // takes effect without restarting the timer (until the cadence itself
    // changes — reload() detects that and re-arms).
    bot.__periodicTimer = setInterval(() => {
      const live = this.#channelById.get(channelId);
      if (live) this.#processQueue(live).catch(() => {});
    }, ms);
    bot.__periodicInterval = channel.response_interval;
    console.log(`[telegram] ${channel.name}: periodic every ${channel.response_interval}`);
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

  async #handleMessage(bot, chatId, text, media, mediaHints, channel, telegramMessageId) {
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
      // Load history BEFORE persisting the new user message so agent.run
      // doesn't see it twice (it re-appends the user message internally),
      // and persist the user row FIRST so an LLM/network failure below
      // doesn't silently drop what the user sent.
      const { messages: history } = await loadSession(sessionId);

      const hasAudio = !!media.audio || mediaHints.includes('audio');
      const hasImage = !!media.images?.length || mediaHints.includes('image');
      const hasVideo = !!media.video || mediaHints.includes('video');
      const userMeta = telegramMessageId ? { telegram_message_id: telegramMessageId } : {};

      await appendMessage(sessionId, {
        role: 'user',
        content: text || '',
        hasImage,
        hasAudio,
        hasVideo,
        meta: userMeta,
      });

      try {
        const result = await this.#agent.run(text, history, {
          agentId: channel.agent_id,
          channelId: channel.id,
          chatId: String(chatId),
          sessionId,
          systemPrompt: channel?.system_prompt,
          modelConfig,
          images: media.images || undefined,
          audio: media.audio || undefined,
          audioMime: media.audioMime || undefined,
          video: media.video || undefined,
          videoMime: media.videoMime || undefined,
          mediaHints: mediaHints.length ? mediaHints : undefined,
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
    this.#channelById.clear();
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
