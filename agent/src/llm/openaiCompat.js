import { imageMime } from './message.js';
import { assertOk, parseFrame, readLines } from './transport.js';

// Shared adapter for every gateway that speaks the OpenAI chat-completions
// dialect (OpenRouter, Requesty, any self-declared "OpenAI-compatible" router).
// They differ only in where the endpoint lives, which extra headers they want,
// and how a request asks for reasoning — so those are the only knobs.

// Gateways read media only from the OpenAI multipart shape: `content`
// becomes an array of typed parts, text first. The docs want three different
// encodings for the same bytes — images and video as data URLs, audio as raw
// base64 beside a bare format name — so each type is spelled out here.
function toOpenAIContent(m) {
  if (!m.images?.length && !m.audio && !m.video) return m.content || '';
  const parts = [];
  if (m.content) parts.push({ type: 'text', text: m.content });
  for (const img of m.images || []) {
    parts.push({ type: 'image_url', image_url: { url: `data:${imageMime(img)};base64,${img}` } });
  }
  if (m.audio) {
    const format = (m.audioMime || 'audio/ogg').split('/')[1].replace(/^x-/, '');
    parts.push({ type: 'input_audio', input_audio: { data: m.audio, format } });
  }
  if (m.video) {
    parts.push({ type: 'video_url', video_url: { url: `data:${m.videoMime || 'video/mp4'};base64,${m.video}` } });
  }
  return parts;
}

// OpenAI requires more of a tool call than the internal shape carries: every
// call needs an `id` and an explicit `type`, its arguments must be a JSON
// *string*, and every tool result must name the call it answers via
// `tool_call_id`. Sending the internal shape verbatim makes strict upstream
// providers reject the whole request.
function toOpenAIMessages(messages) {
  return messages.map(m => {
    const msg = { role: m.role, content: toOpenAIContent(m) };
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

// OpenRouter names reasoning output `reasoning`; DeepSeek-style upstreams
// (and gateways that pass them through) use `reasoning_content`.
function reasoningOf(x) {
  return x?.reasoning || x?.reasoning_content || undefined;
}

/**
 * @param {object} spec
 * @param {string} spec.name           shown in error messages ("Requesty 429: …")
 * @param {string} spec.path           appended to the model's base URL
 * @param {object} [spec.headers]      extra request headers
 * @param {object} [spec.reasoning]    body fields merged in when the model has thinking enabled
 */
export function openAICompatible({ name, path, headers = {}, reasoning = {} }) {
  function buildBody(messages, tools, opts, stream) {
    const body = { model: opts.model, messages: toOpenAIMessages(messages), stream };
    // Hybrid models (Claude, Gemini, Qwen3, GPT-5) don't reason unless asked, and
    // a model that doesn't reason returns no reasoning field to capture.
    if (opts.think) Object.assign(body, reasoning);
    if (tools.length > 0) body.tools = toOpenAITools(tools);
    return body;
  }

  async function post(messages, tools, opts, stream) {
    const res = await fetch(`${opts.baseUrl.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${opts.apiKey}`,
        ...headers,
      },
      body: JSON.stringify(buildBody(messages, tools, opts, stream)),
    });
    await assertOk(res, name);
    return res;
  }

  async function chat(messages, tools, opts) {
    const res = await post(messages, tools, opts, false);
    const choice = (await res.json()).choices?.[0]?.message;
    return {
      role: 'assistant',
      content: choice?.content || '',
      // Capture reasoning so it persists and renders like Ollama's `thinking`.
      thinking: reasoningOf(choice),
      tool_calls: parseToolCalls(choice?.tool_calls),
    };
  }

  async function chatStream(messages, tools, opts, onEvent) {
    const res = await post(messages, tools, opts, true);

    let fullContent = '', fullThinking = '', toolCalls = [], currentIdx = -1;
    for await (const line of readLines(res)) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      const chunk = parseFrame(line.slice(6), name);
      if (!chunk) continue;
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      const thought = reasoningOf(delta);
      if (thought) { fullThinking += thought; onEvent?.('thinking', thought); }
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

  return { chat, chatStream };
}
