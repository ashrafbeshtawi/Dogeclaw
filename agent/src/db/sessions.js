import { adminQuery } from './pool.js';

const HISTORY_LIMIT = 40;

function rowToMessage(r) {
  const out = { id: r.id, role: r.role, content: r.content };
  if (r.tool_calls) out.toolCalls = r.tool_calls;
  if (r.thinking) out.thinking = r.thinking;
  if (r.has_image) out.hasImage = true;
  if (r.has_audio) out.hasAudio = true;
  if (r.meta && Object.keys(r.meta).length) out.meta = r.meta;
  return out;
}

export async function loadSession(id) {
  const sRes = await adminQuery(
    `SELECT id, agent_id, agent_name, source, channel_id, channel_name, chat_id
       FROM sessions WHERE id = $1`,
    [id],
  );
  if (sRes.rowCount === 0) return { messages: [] };
  const s = sRes.rows[0];

  const mRes = await adminQuery(
    `SELECT id, role, content, tool_calls, thinking, has_image, has_audio, meta
       FROM (
         SELECT id, role, content, tool_calls, thinking, has_image, has_audio, meta
         FROM session_messages
         WHERE session_id = $1
         ORDER BY id DESC
         LIMIT $2
       ) recent
       ORDER BY id ASC`,
    [id, HISTORY_LIMIT],
  );

  return {
    messages: mRes.rows.map(rowToMessage),
    agentId: s.agent_id,
    agentName: s.agent_name,
    source: s.source,
    channel: s.channel_name,
    channelId: s.channel_id,
    chatId: s.chat_id,
  };
}

export async function ensureSession(id, meta = {}) {
  await adminQuery(
    `INSERT INTO sessions (id, agent_id, agent_name, source, channel_id, channel_name, chat_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       agent_id     = COALESCE(EXCLUDED.agent_id,     sessions.agent_id),
       agent_name   = COALESCE(EXCLUDED.agent_name,   sessions.agent_name),
       source       = COALESCE(EXCLUDED.source,       sessions.source),
       channel_id   = COALESCE(EXCLUDED.channel_id,   sessions.channel_id),
       channel_name = COALESCE(EXCLUDED.channel_name, sessions.channel_name),
       chat_id      = COALESCE(EXCLUDED.chat_id,      sessions.chat_id),
       updated_at   = NOW()`,
    [
      id,
      meta.agentId ?? null,
      meta.agentName ?? null,
      meta.source ?? 'web',
      meta.channelId ?? null,
      meta.channelName ?? null,
      meta.chatId ?? null,
    ],
  );
}

export async function appendMessage(sessionId, msg) {
  await adminQuery(
    `INSERT INTO session_messages
       (session_id, role, content, tool_calls, thinking, has_image, has_audio, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      sessionId,
      msg.role,
      msg.content ?? '',
      msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
      msg.thinking ?? null,
      !!msg.hasImage,
      !!msg.hasAudio,
      JSON.stringify(msg.meta || {}),
    ],
  );
  await adminQuery('UPDATE sessions SET updated_at = NOW() WHERE id = $1', [sessionId]);
}

export async function listSessions() {
  const res = await adminQuery(
    `SELECT s.id, s.agent_id, s.agent_name, s.source,
            (SELECT content FROM session_messages
              WHERE session_id = s.id ORDER BY id DESC LIMIT 1) AS preview
       FROM sessions s
      ORDER BY s.updated_at DESC`,
  );
  return res.rows.map(r => ({
    id: r.id,
    agentId: r.agent_id,
    agentName: r.agent_name,
    source: r.source || 'web',
    preview: (r.preview || '').slice(0, 60),
  }));
}

export async function deleteSession(id) {
  const res = await adminQuery('DELETE FROM sessions WHERE id = $1', [id]);
  return res.rowCount > 0;
}

export async function resetSession(id) {
  await adminQuery('DELETE FROM session_messages WHERE session_id = $1', [id]);
  await adminQuery('UPDATE sessions SET updated_at = NOW() WHERE id = $1', [id]);
}

export async function findActiveTelegramSession(channelId, chatId) {
  const res = await adminQuery(
    `SELECT id FROM sessions
      WHERE channel_id = $1 AND chat_id = $2
      ORDER BY updated_at DESC LIMIT 1`,
    [channelId, String(chatId)],
  );
  return res.rows[0]?.id || null;
}
