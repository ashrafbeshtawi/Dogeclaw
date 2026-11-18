import { openAICompatible } from './openaiCompat.js';

const REFERER = 'https://dogeclaw.beshtawi.online';

// OpenRouter's base URL is the bare host (https://openrouter.ai); the API
// version lives in the path. Reasoning is opt-in via `reasoning.enabled`.
export const { chat, chatStream } = openAICompatible({
  name: 'OpenRouter',
  path: '/api/v1/chat/completions',
  headers: { 'HTTP-Referer': REFERER },
  reasoning: { reasoning: { enabled: true } },
});
