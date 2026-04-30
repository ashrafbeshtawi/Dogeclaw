import TelegramBot from 'node-telegram-bot-api';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { agentQuery as query } from '../db/pool.js';
import config from '../config.js';
// transcribeAudio imported dynamically where needed

const MAX_MSG_LEN = 4096;

export class TelegramManager {
  #agent;
  #expressApp;
  #bots = new Map();
  #timers = new Map();
  #chatSessions = new Map(); // "channelName-chatId" -> current session ID

  constructor(agent) {
    this.#agent = agent;
  }

  async start(expressApp) {
    this.#expressApp = expressApp;
    await this.reload();
  }

  async reload() {
    // Stop existing bots
    for (const bot of this.#bots.values()) {
      try { await bot.stopPolling(); } catch {}
    }
    this.#bots.clear();
    for (const timer of this.#timers.values()) clearInterval(timer);
    this.#timers.clear();

    // Load channels from DB
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

    // Log polling errors
    bot.on('polling_error', (err) => {
      console.error(`[telegram] ${channel.name} polling error: ${err.message}`);
    });

    bot.on('error', (err) => {
      console.error(`[telegram] ${channel.name} error: ${err.message}`);
    });

    // Webhook mode
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

      // Check allowed users
      if (allowedUsers.length > 0 && !allowedUsers.includes(msg.from.id)) {
        console.log(`[telegram] ${channel.name}: user ${msg.from.id} not in allowlist`);
        return;
      }

      if (msg.text === '/start') {
        return bot.sendMessage(msg.chat.id, `Hi! I'm DogeClaw (${channel.agent_name}). Commands:\n/new - Start a new chat\n/reset - Clear current chat`);
      }
      if (msg.text === '/reset') {
        const sid = `tg-${channel.name}-${msg.chat.id}`;
        await saveSession(sid, { messages: [], agentId: channel.agent_id, agentName: channel.agent_name, channel: channel.name, source: 'telegram' });
        return bot.sendMessage(msg.chat.id, 'Conversation reset.');
      }
      if (msg.text === '/new') {
        // Create a new session with a unique suffix
        const newSid = `tg-${channel.name}-${msg.chat.id}-${Date.now()}`;
        this.#chatSessions = this.#chatSessions || new Map();
        this.#chatSessions.set(`${channel.name}-${msg.chat.id}`, newSid);
        await saveSession(newSid, { messages: [], agentId: channel.agent_id, agentName: channel.agent_name, channel: channel.name, source: 'telegram' });
        return bot.sendMessage(msg.chat.id, 'New chat started. Previous chat is still visible in the web UI.');
      }

      // Handle media
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
          // Pass audio to handleMessage — agent decides whether to transcribe or forward
          if (channel.response_mode === 'periodic') {
            // For periodic, transcribe now since we can't pass binary in queue
            const { transcribeAudio: ta } = await import('../audio.js');
            textContent = await ta(audioB64, mime);
            await this.#enqueue(channel.name, msg, textContent, images);
            return;
          }
          await this.#handleMessage(bot, msg.chat.id, textContent, images, channel, audioB64, mime);
          return;
        } catch (err) {
          console.error(`[telegram] ${channel.name}: failed to handle audio: ${err.message}`);
          await bot.sendMessage(msg.chat.id, `Failed to process audio: ${err.message}`).catch(() => {});
          return;
        }
      }

      if (!textContent && !images) return;

      if (channel.response_mode === 'periodic') {
        await this.#enqueue(channel.name, msg, textContent, images);
        return;
      }

      // Immediate mode
      await this.#handleMessage(bot, msg.chat.id, textContent, images, channel);
    });

    this.#bots.set(channel.id, bot);

    // Periodic timer
    if (channel.response_mode === 'periodic' && channel.response_interval) {
      const ms = parseInterval(channel.response_interval);
      if (ms > 0) {
        this.#timers.set(channel.id, setInterval(() => this.#processQueue(channel), ms));
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

  async #handleMessage(bot, chatId, text, images, channel, audioB64, audioMime) {
    bot.sendChatAction(chatId, 'typing').catch(() => {});

    const sessionKey = `${channel.name}-${chatId}`;
    const sessionId = this.#chatSessions.get(sessionKey) || `tg-${channel.name}-${chatId}`;
    const sessionData = await loadSession(sessionId);
    const history = sessionData.messages || [];

    const modelConfig = {
      base_url: channel.base_url,
      model_id: channel.model_id,
      think: channel.think,
      accepts: channel.accepts || ['text'],
      provider: channel.provider || 'ollama',
      apiKey: channel.api_key,
    };

    try {
      const result = await this.#agent.run(text, history, {
        agentId: channel.agent_id,
        systemPrompt: channel?.system_prompt,
        modelConfig,
        images: images || undefined,
        audio: audioB64 || undefined,
        audioMime: audioMime || undefined,
      });
      history.push({ role: 'user', content: text });
      history.push({
        role: 'assistant', content: result.content,
        ...(result.toolCalls?.length ? { toolCalls: result.toolCalls } : {}),
      });
      while (history.length > 40) history.shift();

      await saveSession(sessionId, {
        messages: history,
        agentId: channel.agent_id,
        agentName: channel.agent_name,
        channel: channel.name,
        source: 'telegram',
      });

      await sendLong(bot, chatId, result.content);
    } catch (err) {
      console.error(`[telegram] Error handling message: ${err.message}`);
      await bot.sendMessage(chatId, `Error: ${err.message}`).catch(() => {});
    }
  }

  async #enqueue(channelName, msg, text, images) {
    const queueFile = join(config.paths.queues, `${channelName}.json`);
    let queue = [];
    try { queue = JSON.parse(await readFile(queueFile, 'utf-8')); } catch {}
    queue.push({ chatId: msg.chat.id, text, images, from: msg.from.id, ts: Date.now() });
    await mkdir(config.paths.queues, { recursive: true });
    await writeFile(queueFile, JSON.stringify(queue), 'utf-8');
  }

  async #processQueue(channel) {
    const bot = this.#bots.get(channel.id);
    if (!bot) return;
    const queueFile = join(config.paths.queues, `${channel.name}.json`);
    let queue = [];
    try { queue = JSON.parse(await readFile(queueFile, 'utf-8')); } catch { return; }
    if (!queue.length) return;
    await writeFile(queueFile, '[]', 'utf-8');

    const byChat = new Map();
    for (const item of queue) {
      if (!byChat.has(item.chatId)) byChat.set(item.chatId, []);
      byChat.get(item.chatId).push(item);
    }

    for (const [chatId, messages] of byChat) {
      const combined = messages.map(m => m.text).join('\n---\n');
      try {
        const result = await this.#agent.run(combined, [], {
          agentId: channel.agent_id,
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

  async sendMessage(chatId, text) {
    const bot = this.#bots.values().next().value;
    if (bot) await sendLong(bot, chatId, text);
  }

  stop() {
    for (const bot of this.#bots.values()) {
      try { bot.stopPolling(); } catch {}
    }
    for (const timer of this.#timers.values()) clearInterval(timer);
  }
}

async function sendLong(bot, chatId, text) {
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

async function loadSession(id) {
  try {
    const file = join(config.paths.sessions, `${id}.json`);
    return JSON.parse(await readFile(file, 'utf-8'));
  } catch { return { messages: [] }; }
}

async function saveSession(id, data) {
  await mkdir(config.paths.sessions, { recursive: true });
  const file = join(config.paths.sessions, `${id}.json`);
  await writeFile(file, JSON.stringify(data), 'utf-8');
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
