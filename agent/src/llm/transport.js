// HTTP and streaming plumbing shared by every provider.

// A provider validation error names every offending field, so the old 200-char
// cap routinely cut the body off mid-token and left the event log useless —
// an OpenRouter 400 whose payload listed six validation errors arrived as
// `...'ChatCompletionMessageFunctionTool` and the cause had to be read out of
// the source instead.
const MAX_ERROR_CHARS = 2000;

/** Throws with as much of the provider's error body as is useful to read. */
export async function assertOk(res, provider) {
  if (res.ok) return;
  let body;
  try { body = await res.text(); } catch { body = '<unreadable response body>'; }
  const shown = body.length > MAX_ERROR_CHARS
    ? `${body.slice(0, MAX_ERROR_CHARS)}…[${body.length - MAX_ERROR_CHARS} more chars]`
    : body;
  throw new Error(`${provider} ${res.status}: ${shown}`);
}

/**
 * Parses one streamed JSON frame. A frame we cannot read is a real event —
 * silently skipping it made a malformed stream indistinguishable from an
 * empty one — so it is logged and dropped rather than thrown, since one bad
 * frame should not abandon a response that is otherwise arriving fine.
 */
export function parseFrame(json, provider) {
  try {
    return JSON.parse(json);
  } catch {
    console.warn(`[llm] ${provider}: dropped unparseable stream frame (${json.length} chars)`);
    return null;
  }
}

/** Yields complete newline-delimited lines from a streaming response body. */
export async function* readLines(res) {
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
