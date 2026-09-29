// The internal message shape.
//
// This is the format the agent loop speaks. It is NOT any provider's wire
// format — that distinction is the whole point of this file. It used to be
// Ollama's wire format by accident, because `chatOllama` passed messages
// straight through, and every other provider was expected to notice and
// convert. Google did. OpenRouter did not, which is how tool calls went out
// missing `id`, `type` and `tool_call_id` for as long as they did.
//
// A message is:
//
//   role         'system' | 'user' | 'assistant' | 'tool'
//   content      string
//   tool_calls   assistant only: [{ id, function: { name, arguments } }]
//                `arguments` is an OBJECT here — the tool registry executes on
//                it. Providers that require a JSON string stringify on the way
//                out and parse on the way back in.
//   tool_call_id tool results only: the id of the call being answered
//   images       user only: array of base64 strings
//   audio/video  user only: base64 string, with audioMime / videoMime
//
// Anything prefixed with `_` is a provider's private side channel. It must
// never reach the wire, and only its owner may read it:
//
//   _toolName      google   — names the function a tool result answers, since
//                             Gemini keys functionResponse by name, not id
//   _geminiParts   google   — raw response parts, replayed next turn so
//                             thoughtSignature survives
//   _finishReason  google   — STOP / MAX_TOKENS / SAFETY / ... for diagnostics
//
// Adding a provider means adding a conversion in both directions, not
// widening this shape.

/** Drops `_`-prefixed side channels so a provider never leaks them to the wire. */
export function stripInternalFields(msg) {
  const out = {};
  for (const key of Object.keys(msg)) {
    if (!key.startsWith('_')) out[key] = msg[key];
  }
  return out;
}
