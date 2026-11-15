import { openAICompatible } from './openaiCompat.js';

// Requesty (https://requesty.ai) — OpenRouter-style gateway. Its base URL
// already carries the API version (https://router.requesty.ai/v1), and model
// ids are "<vendor>/<model>". Reasoning uses the standard OpenAI field.
export const { chat, chatStream } = openAICompatible({
  name: 'Requesty',
  path: '/chat/completions',
  reasoning: { reasoning_effort: 'medium' },
});
