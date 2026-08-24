// Pure helper — computes where the session history window starts.
//
// Provider prompt caches (Gemini implicit, OpenAI/OpenRouter automatic,
// Ollama's local KV cache) work on token prefixes: a request only gets
// cache hits for the part that is byte-identical from position 0. A
// "last N messages" sliding window shifts the front of the history on
// every turn, so long sessions never hit the cache again. Instead we
// trim in blocks: the window start only moves once per TRIM_BLOCK
// messages, so the prefix stays stable between trims and each trim
// costs one cache miss instead of a permanent one.
//
// Own module so it can be unit-tested in isolation (see
// tests/specs/history-window.spec.js), same pattern as timestampNote.

export const KEEP_MIN = 300; // window floor: always keep at least this many
export const TRIM_BLOCK = 150; // trim granularity: start moves in steps of this

// Index of the first message to keep, given the session's total message
// count. Window size oscillates between KEEP_MIN and KEEP_MIN + TRIM_BLOCK - 1.
export function historyWindowStart(count) {
  return Math.floor(Math.max(0, count - KEEP_MIN) / TRIM_BLOCK) * TRIM_BLOCK;
}
