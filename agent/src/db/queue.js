import { adminQuery } from './pool.js';

export async function enqueue(channelId, { chatId, userId, text, images }) {
  await adminQuery(
    `INSERT INTO queued_messages (channel_id, chat_id, user_id, text, images)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      channelId,
      String(chatId),
      userId != null ? String(userId) : null,
      text || '',
      images ? JSON.stringify(images) : null,
    ],
  );
}

// Atomically take everything queued for this channel right now. New rows
// inserted *after* this query starts won't be in the result set — they'll
// be picked up by the next tick. This replaces the old "truncate then
// process" pattern with a single DB statement.
export async function claimBatch(channelId) {
  const res = await adminQuery(
    `DELETE FROM queued_messages
      WHERE channel_id = $1
      RETURNING id, chat_id, user_id, text, images, created_at`,
    [channelId],
  );
  return res.rows;
}

export async function listQueue(channelId) {
  const res = await adminQuery(
    `SELECT * FROM queued_messages WHERE channel_id = $1 ORDER BY id`,
    [channelId],
  );
  return res.rows;
}
