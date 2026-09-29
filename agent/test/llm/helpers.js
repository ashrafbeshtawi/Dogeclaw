// Shared stubbing for the per-provider tests. No network, ever.

/** Swaps global fetch for the duration of a test; returns the restore fn. */
export function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

/** Captures the request URL and parsed body of a single call. */
export function capture(responseFactory) {
  const seen = {};
  const restore = stubFetch(async (url, init) => {
    seen.url = url;
    seen.headers = init?.headers;
    seen.body = init?.body ? JSON.parse(init.body) : undefined;
    return responseFactory(url);
  });
  return { seen, restore };
}

/** An SSE response body from a list of already-serialised frames. */
export function sse(frames) {
  return new Response(frames.join('\n') + '\n', { status: 200 });
}

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status });
}

/**
 * One internal conversation exercising every shape a provider must handle:
 * a system turn, a user turn, an assistant turn with a tool call, and the
 * tool result answering it — including the `_`-prefixed side channels that
 * must never reach any wire.
 */
export function conversation() {
  return [
    { role: 'system', content: 'be brief' },
    { role: 'user', content: 'what is in the table?' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_1', function: { name: 'db_run_sql', arguments: { sql: 'SELECT 1' } } }],
    },
    { role: 'tool', content: '{"rows":[1]}', tool_call_id: 'call_1', _toolName: 'db_run_sql' },
  ];
}

/** Recursively asserts no key starting with `_` survives into a wire body. */
export function findInternalFields(value, path = '') {
  const found = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => found.push(...findInternalFields(v, `${path}[${i}]`)));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('_')) found.push(`${path}.${k}`);
      found.push(...findInternalFields(v, `${path}.${k}`));
    }
  }
  return found;
}
