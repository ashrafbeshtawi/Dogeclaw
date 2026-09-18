import { assertOk, parseFrame, readLines } from './transport.js';

const NAME = 'OpenRouter';
const REFERER = 'https://dogeclaw.beshtawi.online';

// OpenAI requires more of a tool call than the internal shape carries: every
// call needs an `id` and an explicit `type`, its arguments must be a JSON
// *string*, and every tool result must name the call it answers via
// `tool_call_id`. Sending the internal shape verbatim makes strict upstream
// providers reject the whole request.
function toOpenAIMessages(messages) {
  return messages.map(m => {
    const msg = { role: m.role, content: m.content || '' };
    if (m.tool_calls) {
      msg.tool_calls = m.tool_calls.map((tc, i) => ({
        id: tc.id || `call_${i}`,
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: typeof tc.function.arguments === 'string'
            ? tc.function.arguments
            : JSON.stringify(tc.function.arguments ?? {}),
        },
      }));
    }
    if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
    return msg;
  });
}

function toOpenAITools(tools) {
  return tools.map(t => ({ type: 'function', function: t.function }));
}

// Keep the provider's id: it is the only thing tying the tool result we send
// next round back to this call. Synthesize one if a provider omits it, so the
// pairing still holds rather than failing validation later.
function parseToolCalls(tcs) {
  if (!tcs?.length) return undefined;
  return tcs.map((tc, i) => ({
    id: tc.id || `call_${i}`,
    function: {
      name: tc.function.name,
      // Back to an object: the tool registry executes on the parsed form.
      arguments: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments,
    },
  }));
}

function buildBody(messages, tools, opts, stream) {
  const body = { model: opts.model, messages: toOpenAIMessages(messages), stream };
  // Hybrid models (Claude, Gemini, Qwen3, GPT-5) don't reason unless asked, and
  // a model that doesn't reason returns no `reasoning` field to capture.
  if (opts.think) body.reasoning = { enabled: true };
  if (tools.length > 0) body.tools = toOpenAITools(tools);
  return body;
}

async function post(messages, tools, opts, stream) {
  const res = await fetch(`${opts.baseUrl}/api/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${opts.apiKey}`,
      'HTTP-Referer': REFERER,
    },
    body: JSON.stringify(buildBody(messages, tools, opts, stream)),
  });
  await assertOk(res, NAME);
  return res;
}

export async function chat(messages, tools, opts) {
  const res = await post(messages, tools, opts, false);
  const choice = (await res.json()).choices?.[0]?.message;
  return {
    role: 'assistant',
    content: choice?.content || '',
    // OpenRouter surfaces reasoning-model output in `reasoning` — capture it
    // so it persists and renders like Ollama's `thinking`.
    thinking: choice?.reasoning || undefined,
    tool_calls: parseToolCalls(choice?.tool_calls),
  };
}

export async function chatStream(messages, tools, opts, onEvent) {
  const res = await post(messages, tools, opts, true);

  let fullContent = '', fullThinking = '', toolCalls = [], currentIdx = -1;
  for await (const line of readLines(res)) {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
    const chunk = parseFrame(line.slice(6), NAME);
    if (!chunk) continue;
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;
    if (delta.reasoning) { fullThinking += delta.reasoning; onEvent?.('thinking', delta.reasoning); }
    if (delta.content) { fullContent += delta.content; onEvent?.('content', delta.content); }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        if (tc.index !== undefined && tc.index !== currentIdx) { currentIdx = tc.index; toolCalls.push({ id: null, function: { name: '', arguments: '' } }); }
        const cur = toolCalls[toolCalls.length - 1];
        // The id arrives on the first delta of a call and is absent from the
        // rest, so take it once rather than concatenating it.
        if (tc.id && !cur.id) cur.id = tc.id;
        if (tc.function?.name) cur.function.name += tc.function.name;
        if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
      }
    }
  }
  const parsed = toolCalls.length
    ? toolCalls.map((tc, i) => ({ id: tc.id || `call_${i}`, function: { name: tc.function.name, arguments: JSON.parse(tc.function.arguments || '{}') } }))
    : undefined;
  return { role: 'assistant', content: fullContent, thinking: fullThinking || undefined, tool_calls: parsed };
}
