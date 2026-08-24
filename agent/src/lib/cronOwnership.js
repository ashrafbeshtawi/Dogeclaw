// Pure helper — does a cron job belong to the calling conversation?
//
// manage_cron's `add` binds every new job to the caller (telegram
// channel+chat, or web session). list/remove must enforce the same
// boundary, otherwise any conversation can read other chats' scheduled
// prompts and cancel their jobs. Mirrors the ownership check in
// telegram.js #handleCronCommand.
//
// Own module so it can be unit-tested in isolation (see
// agent/test/cronOwnership.test.js).

export function ownsJob(job, context = {}) {
  const telegramMatch = context.channelId != null && context.chatId != null
    && job.channel_id === context.channelId
    && String(job.chat_id) === String(context.chatId);
  const sessionMatch = !!context.sessionId && job.session_id === context.sessionId;
  return telegramMatch || sessionMatch;
}
