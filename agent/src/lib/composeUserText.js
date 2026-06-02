// Pure helper — turns a user-supplied text + attached media (or media
// "hints" when the bytes were intentionally not downloaded) into the
// outgoing LLM message text. For each media type the model's `accepts`
// list doesn't cover, a `[Attached: <type>]` placeholder is appended so
// the model is at least aware that something was sent.
//
// Extracted to its own module so it can be unit-tested in isolation
// (see tests/specs/media-placeholder.spec.js) without booting the full
// agent / LLM stack.

export const MEDIA_TYPES = ['image', 'audio', 'video'];

export function composeUserText(text, opts = {}, accepts = ['text']) {
  const attached = new Set(opts.mediaHints || []);
  if (opts.images?.length) attached.add('image');
  if (opts.audio)          attached.add('audio');
  if (opts.video)          attached.add('video');

  const placeholders = [];
  for (const type of MEDIA_TYPES) {
    if (attached.has(type) && !accepts.includes(type)) {
      placeholders.push(`[Attached: ${type}]`);
    }
  }
  const head = text || '';
  if (!placeholders.length) return head;
  return head ? `${head}\n${placeholders.join(' ')}` : placeholders.join(' ');
}
