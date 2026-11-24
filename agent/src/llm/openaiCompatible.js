import { openAICompatible } from './openaiCompat.js';

// Any gateway that implements POST <base>/chat/completions in the OpenAI
// dialect (OrcaRouter, LiteLLM, vLLM, OpenAI itself, …). The base URL is
// whatever the vendor documents as its "OpenAI base URL", version included
// (e.g. https://api.example.com/v1).
export const { chat, chatStream } = openAICompatible({
  name: 'OpenAI-compatible',
  path: '/chat/completions',
  reasoning: { reasoning_effort: 'medium' },
});
