import { assertOk, parseFrame, readLines } from './transport.js';

const NAME = 'Google';
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

// Gemini shares nothing with the internal shape: roles are named differently,
// tool results are keyed by function NAME rather than call id (hence
// `_toolName`), and an assistant turn may have to be replayed as raw parts to
// keep its thoughtSignature (hence `_geminiParts`).
function toGeminiContents(messages) {
  const contents = [];
  let systemInstruction = null;

  for (const m of messages) {
    if (m.role === 'system') {
      systemInstruction = { parts: [{ text: m.content }] };
      continue;
    }

    // Tool result → functionResponse
    if (m.role === 'tool') {
      let parsed;
      try { parsed = JSON.parse(m.content); } catch { parsed = m.content; }
      contents.push({
        role: 'function',
        parts: [{ functionResponse: { name: m._toolName || 'tool', response: parsed } }],
      });
      continue;
    }

    // Assistant message with raw Gemini parts (preserves thoughtSignature)
    if (m.role === 'assistant' && m._geminiParts) {
      contents.push({ role: 'model', parts: m._geminiParts });
      continue;
    }

    const role = m.role === 'assistant' ? 'model' : 'user';
    const parts = [];
    if (m.content) parts.push({ text: m.content });
    // Forward media as inline_data parts. Caller (agent.js) only sets these
    // fields when the model's `accepts` list covers the media type, so this
    // never sends audio/video to a text-only model.
    if (m.audio) {
      parts.push({ inline_data: { mime_type: m.audioMime || 'audio/ogg', data: m.audio } });
    }
    if (m.video) {
      parts.push({ inline_data: { mime_type: m.videoMime || 'video/mp4', data: m.video } });
    }
    if (m.images?.length) {
      for (const img of m.images) {
        // Base64 string; mime sniffing is the operator's problem at upload.
        parts.push({ inline_data: { mime_type: 'image/png', data: img } });
      }
    }
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        parts.push({ functionCall: { name: tc.function.name, args: tc.function.arguments } });
      }
    }
    if (parts.length === 0) parts.push({ text: '' });
    contents.push({ role, parts });
  }
  return { contents, systemInstruction };
}

function toGeminiTools(tools) {
  if (!tools.length) return undefined;
  return [{ functionDeclarations: tools.map(t => {
    const fn = t.function;
    return { name: fn.name, description: fn.description, parameters: fn.parameters };
  }) }];
}

function parseGeminiResponse(candidate) {
  let content = '';
  const toolCalls = [];
  const rawParts = candidate?.content?.parts || [];
  for (const part of rawParts) {
    if (part.text) content += part.text;
    if (part.functionCall) {
      toolCalls.push({ function: { name: part.functionCall.name, arguments: part.functionCall.args || {} } });
    }
  }
  const result = { role: 'assistant', content, tool_calls: toolCalls.length ? toolCalls : undefined };
  // Preserve raw parts (including thoughtSignature) on every Gemini response,
  // not only when functionCall is present. This lets the next turn pass the
  // signature back so the model can resume its internal reasoning — without
  // this, an empty turn whose only parts were `thoughtSignature` was being
  // surfaced as `(no response)` and the model lost its state.
  if (rawParts.length) result._geminiParts = rawParts;
  // Surface finishReason so callers (and the agent log) can tell why an
  // empty candidate came back: STOP / MAX_TOKENS / SAFETY / RECITATION /
  // PROHIBITED_CONTENT / LANGUAGE / SPII / OTHER.
  if (candidate?.finishReason) result._finishReason = candidate.finishReason;
  return result;
}

function logGeminiEmpty(response, where) {
  if (response.tool_calls?.length) return;
  if (response.content && response.content.trim()) return;
  const reason = response._finishReason || 'unknown';
  const partKinds = (response._geminiParts || []).map(p =>
    p.text ? 'text' : p.functionCall ? 'fn' : p.thoughtSignature ? 'thought' : 'other'
  ).join(',') || 'none';
  console.warn(`[llm] Gemini ${where} returned empty turn (finishReason=${reason}, parts=[${partKinds}])`);
}

function buildBody(messages, tools) {
  const { contents, systemInstruction } = toGeminiContents(messages);
  const body = { contents };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  const geminiTools = toGeminiTools(tools);
  if (geminiTools) body.tools = geminiTools;
  return body;
}

// `query` carries the params that precede the key — only the streaming call
// needs one (`alt=sse`), and it must stay ahead of `key=` as before.
async function post(messages, tools, opts, method, query = '') {
  const base = opts.baseUrl || DEFAULT_BASE_URL;
  const res = await fetch(`${base}/v1beta/models/${opts.model}:${method}?${query}key=${opts.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildBody(messages, tools)),
  });
  await assertOk(res, NAME);
  return res;
}

export async function chat(messages, tools, opts) {
  const res = await post(messages, tools, opts, 'generateContent');
  const data = await res.json();
  const parsed = parseGeminiResponse(data.candidates?.[0]);
  logGeminiEmpty(parsed, 'non-stream');
  return parsed;
}

export async function chatStream(messages, tools, opts, onEvent) {
  const res = await post(messages, tools, opts, 'streamGenerateContent', 'alt=sse&');

  let fullContent = '';
  const toolCalls = [];
  const allRawParts = [];
  let finishReason = null;

  for await (const line of readLines(res)) {
    if (!line.startsWith('data: ')) continue;
    const chunk = parseFrame(line.slice(6), NAME);
    if (!chunk) continue;
    const candidate = chunk.candidates?.[0];
    if (candidate?.finishReason) finishReason = candidate.finishReason;
    const parts = candidate?.content?.parts || [];
    for (const part of parts) {
      allRawParts.push(part);
      if (part.text) { fullContent += part.text; onEvent?.('content', part.text); }
      if (part.functionCall) {
        toolCalls.push({ function: { name: part.functionCall.name, arguments: part.functionCall.args || {} } });
      }
    }
  }

  const result = { role: 'assistant', content: fullContent, tool_calls: toolCalls.length ? toolCalls : undefined };
  // Always preserve raw parts so thoughtSignature carries to the next turn.
  if (allRawParts.length) result._geminiParts = allRawParts;
  if (finishReason) result._finishReason = finishReason;
  logGeminiEmpty(result, 'stream');
  return result;
}
