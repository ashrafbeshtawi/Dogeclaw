import config from './config.js';

// --- Router ---

export async function chat(messages, tools = [], opts = {}) {
  if (opts.provider === 'openrouter') return chatOpenAI(messages, tools, opts);
  if (opts.provider === 'google') return chatGoogle(messages, tools, opts);
  return chatOllama(messages, tools, opts);
}

export async function chatStream(messages, tools = [], opts = {}, onEvent) {
  if (opts.provider === 'openrouter') return chatStreamOpenAI(messages, tools, opts, onEvent);
  if (opts.provider === 'google') return chatStreamGoogle(messages, tools, opts, onEvent);
  return chatStreamOllama(messages, tools, opts, onEvent);
}

// ============================================================
// Ollama
// ============================================================

async function chatOllama(messages, tools, opts) {
  const baseUrl = opts.baseUrl || config.ollama.url;
  const body = { model: opts.model, messages, stream: false, think: opts.think ?? false };
  if (tools.length > 0) body.tools = tools;

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).message;
}

async function chatStreamOllama(messages, tools, opts, onEvent) {
  const baseUrl = opts.baseUrl || config.ollama.url;
  const body = { model: opts.model, messages, stream: true, think: opts.think ?? false };
  if (tools.length > 0) body.tools = tools;

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);

  let fullContent = '', fullThinking = '', toolCalls = null;
  for await (const line of readLines(res)) {
    let chunk; try { chunk = JSON.parse(line); } catch { continue; }
    if (chunk.message?.thinking) { fullThinking += chunk.message.thinking; onEvent?.('thinking', chunk.message.thinking); }
    if (chunk.message?.content) { fullContent += chunk.message.content; onEvent?.('content', chunk.message.content); }
    if (chunk.message?.tool_calls) toolCalls = chunk.message.tool_calls;
  }
  return { role: 'assistant', content: fullContent, thinking: fullThinking, tool_calls: toolCalls || undefined };
}

// ============================================================
// OpenAI-compatible (OpenRouter)
// ============================================================

function toOpenAIMessages(messages) {
  return messages.map(m => {
    const msg = { role: m.role, content: m.content || '' };
    if (m.tool_calls) msg.tool_calls = m.tool_calls;
    return msg;
  });
}

function toOpenAITools(tools) {
  return tools.map(t => ({ type: 'function', function: t.function }));
}

function parseOpenAIToolCalls(tcs) {
  if (!tcs?.length) return undefined;
  return tcs.map(tc => ({
    function: { name: tc.function.name, arguments: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments },
  }));
}

async function chatOpenAI(messages, tools, opts) {
  const body = { model: opts.model, messages: toOpenAIMessages(messages), stream: false };
  if (tools.length > 0) body.tools = toOpenAITools(tools);

  const res = await fetch(`${opts.baseUrl}/api/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${opts.apiKey}`, 'HTTP-Referer': 'https://dogeclaw.beshtawi.online' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const choice = (await res.json()).choices?.[0]?.message;
  return { role: 'assistant', content: choice?.content || '', tool_calls: parseOpenAIToolCalls(choice?.tool_calls) };
}

async function chatStreamOpenAI(messages, tools, opts, onEvent) {
  const body = { model: opts.model, messages: toOpenAIMessages(messages), stream: true };
  if (tools.length > 0) body.tools = toOpenAITools(tools);

  const res = await fetch(`${opts.baseUrl}/api/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${opts.apiKey}`, 'HTTP-Referer': 'https://dogeclaw.beshtawi.online' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);

  let fullContent = '', toolCalls = [], currentIdx = -1;
  for await (const line of readLines(res)) {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
    let chunk; try { chunk = JSON.parse(line.slice(6)); } catch { continue; }
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;
    if (delta.content) { fullContent += delta.content; onEvent?.('content', delta.content); }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        if (tc.index !== undefined && tc.index !== currentIdx) { currentIdx = tc.index; toolCalls.push({ function: { name: '', arguments: '' } }); }
        const cur = toolCalls[toolCalls.length - 1];
        if (tc.function?.name) cur.function.name += tc.function.name;
        if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
      }
    }
  }
  const parsed = toolCalls.length ? toolCalls.map(tc => ({ function: { name: tc.function.name, arguments: JSON.parse(tc.function.arguments || '{}') } })) : undefined;
  return { role: 'assistant', content: fullContent, tool_calls: parsed };
}

// ============================================================
// Google Gemini
// ============================================================

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
  // Preserve raw parts including thoughtSignature for Gemini 3+ models
  if (toolCalls.length) result._geminiParts = rawParts;
  return result;
}

async function chatGoogle(messages, tools, opts) {
  const { contents, systemInstruction } = toGeminiContents(messages);
  const body = { contents };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  const geminiTools = toGeminiTools(tools);
  if (geminiTools) body.tools = geminiTools;

  const url = `${opts.baseUrl || 'https://generativelanguage.googleapis.com'}/v1beta/models/${opts.model}:generateContent?key=${opts.apiKey}`;
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Google ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json();
  return parseGeminiResponse(data.candidates?.[0]);
}

async function chatStreamGoogle(messages, tools, opts, onEvent) {
  const { contents, systemInstruction } = toGeminiContents(messages);
  const body = { contents };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  const geminiTools = toGeminiTools(tools);
  if (geminiTools) body.tools = geminiTools;

  const url = `${opts.baseUrl || 'https://generativelanguage.googleapis.com'}/v1beta/models/${opts.model}:streamGenerateContent?alt=sse&key=${opts.apiKey}`;
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Google ${res.status}: ${(await res.text()).slice(0, 200)}`);

  let fullContent = '';
  const toolCalls = [];
  const allRawParts = [];

  for await (const line of readLines(res)) {
    if (!line.startsWith('data: ')) continue;
    let chunk; try { chunk = JSON.parse(line.slice(6)); } catch { continue; }
    const parts = chunk.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      allRawParts.push(part);
      if (part.text) { fullContent += part.text; onEvent?.('content', part.text); }
      if (part.functionCall) {
        toolCalls.push({ function: { name: part.functionCall.name, arguments: part.functionCall.args || {} } });
      }
    }
  }

  const result = { role: 'assistant', content: fullContent, tool_calls: toolCalls.length ? toolCalls : undefined };
  if (toolCalls.length) result._geminiParts = allRawParts;
  return result;
}

// ============================================================
// Shared utils
// ============================================================

async function* readLines(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.trim()) yield line;
    }
  }
  if (buffer.trim()) yield buffer;
}
