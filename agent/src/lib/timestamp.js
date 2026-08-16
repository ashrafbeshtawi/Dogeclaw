// Pure helper — formats the current date & time (in the operator's
// configured timezone) as a note appended to every outgoing LLM message,
// so the model always knows what time it is right now.
//
// Own module so it can be unit-tested in isolation (see
// tests/specs/message-timestamp.spec.js), same pattern as composeUserText.

export function timestampNote(tz = 'UTC', now = new Date()) {
  let formatted;
  try {
    formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      dateStyle: 'full',
      timeStyle: 'long',
    }).format(now);
  } catch {
    // Invalid timezone in settings must not take down every chat.
    formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      dateStyle: 'full',
      timeStyle: 'long',
    }).format(now);
  }
  return `[Current date/time: ${formatted}]`;
}
