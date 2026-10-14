// Pure helper — does a cron job belong to the calling conversation?
//
// add_cron binds every new job to the caller (telegram
// channel+chat, or web session). list/remove must enforce the same
// boundary, otherwise any conversation can read other chats' scheduled
// prompts and cancel their jobs. telegram.js #handleCronCommand applies the
// same check to /cron.
//
// Own module so it can be unit-tested in isolation (see
// agent/test/cronOwnership.test.js).

export function ownsJob({ target }, context = {}) {
  if (target.kind === 'telegram') {
    return context.channelId != null && context.chatId != null
      && target.channelId === context.channelId
      && target.chatId === String(context.chatId);
  }
  return !!context.sessionId && target.sessionId === context.sessionId;
}
