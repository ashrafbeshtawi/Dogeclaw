// Provider router.
//
// Every provider lives in ./llm/ and owns both directions of its own wire
// conversion. Nothing provider-specific belongs in this file — if a field name
// from one provider's API appears here, the boundary has leaked.
//
// The shape these adapters speak is documented in ./llm/message.js.

import * as google from './llm/google.js';
import * as ollama from './llm/ollama.js';
import * as openrouter from './llm/openrouter.js';

const PROVIDERS = { google, ollama, openrouter };
const DEFAULT_PROVIDER = 'ollama';

// An unset provider is the documented default. A provider we don't know is a
// misconfigured model row, and used to fall through to Ollama silently — so a
// typo looked like a mysteriously wrong model rather than a bad setting.
function adapterFor(provider) {
  const name = provider || DEFAULT_PROVIDER;
  const adapter = PROVIDERS[name];
  if (!adapter) {
    throw new Error(`Unknown model provider "${name}". Known providers: ${Object.keys(PROVIDERS).sort().join(', ')}.`);
  }
  return adapter;
}

export async function chat(messages, tools = [], opts = {}) {
  return adapterFor(opts.provider).chat(messages, tools, opts);
}

export async function chatStream(messages, tools = [], opts = {}, onEvent) {
  return adapterFor(opts.provider).chatStream(messages, tools, opts, onEvent);
}
