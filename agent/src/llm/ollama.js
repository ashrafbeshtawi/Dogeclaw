import config from '../config.js';
import { stripInternalFields } from './message.js';
import { assertOk, parseFrame, readLines } from './transport.js';

const NAME = 'Ollama';

// Ollama's wire format is very close to the internal shape — object-valued
// tool arguments, no call ids — which is exactly why this conversion has to
// exist and be named. Without it the internal shape has no owner and silently
// becomes "whatever Ollama accepts", which is how the other providers ended up
// inheriting it. Today it only strips the `_` side channels; when the two
// formats drift, this is the one place that has to change.
function toOllamaMessages(messages) {
  return messages.map(stripInternalFields);
}

function buildBody(messages, tools, opts, stream) {
  const body = {
    model: opts.model,
    messages: toOllamaMessages(messages),
    stream,
    think: opts.think ?? false,
  };
  if (tools.length > 0) body.tools = tools;
  return body;
}

async function post(messages, tools, opts, stream) {
  const baseUrl = opts.baseUrl || config.ollama.url;
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildBody(messages, tools, opts, stream)),
  });
  await assertOk(res, NAME);
  return res;
}

export async function chat(messages, tools, opts) {
  const res = await post(messages, tools, opts, false);
  return (await res.json()).message;
}

export async function chatStream(messages, tools, opts, onEvent) {
  const res = await post(messages, tools, opts, true);

  let fullContent = '', fullThinking = '', toolCalls = null;
  for await (const line of readLines(res)) {
    const chunk = parseFrame(line, NAME);
    if (!chunk) continue;
    if (chunk.message?.thinking) { fullThinking += chunk.message.thinking; onEvent?.('thinking', chunk.message.thinking); }
    if (chunk.message?.content) { fullContent += chunk.message.content; onEvent?.('content', chunk.message.content); }
    if (chunk.message?.tool_calls) toolCalls = chunk.message.tool_calls;
  }
  return { role: 'assistant', content: fullContent, thinking: fullThinking, tool_calls: toolCalls || undefined };
}
