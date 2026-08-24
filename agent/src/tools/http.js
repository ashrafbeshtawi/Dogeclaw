// Cap response reads: an API answer the model can use fits well under this;
// pointing the tool at a huge file must not buffer it whole.
const MAX_READ_BYTES = 512 * 1024;
const MAX_BODY_CHARS = 10000;

export function register(registry) {
  registry.register('http_request', {
    type: 'function',
    function: {
      name: 'http_request',
      description: 'Make a raw HTTP request and return status, content type, and body. Use this for JSON/REST APIs (any method, custom headers, request body) — web_fetch strips pages to article text and is wrong for APIs. Example: {"method": "POST", "url": "https://api.example.com/items", "headers": {"Content-Type": "application/json", "Authorization": "Bearer ..."}, "body": "{\\"name\\": \\"x\\"}"}.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Request URL' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'], description: 'HTTP method (default GET)' },
          headers: { type: 'object', description: 'Request headers (optional). Set Content-Type yourself when sending a body.' },
          body: { type: 'string', description: 'Raw request body (optional)' },
          timeout_ms: { type: 'number', description: 'Timeout in ms (default 15000, max 60000)' },
        },
        required: ['url'],
      },
    },
  }, async ({ url, method, headers, body, timeout_ms }) => {
    // Some models send headers as a JSON string — tolerate it.
    if (typeof headers === 'string') {
      try { headers = JSON.parse(headers); } catch { return { error: 'headers must be a JSON object' }; }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(timeout_ms || 15000, 60000));
    try {
      const res = await fetch(url, {
        method: method || 'GET',
        headers: headers || undefined,
        body: body || undefined,
        signal: controller.signal,
        redirect: 'follow',
      });
      let text = '';
      let bytes = 0;
      if (res.body) {
        const reader = res.body.getReader();
        const chunks = [];
        while (bytes < MAX_READ_BYTES) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          bytes += value.length;
        }
        if (bytes >= MAX_READ_BYTES) reader.cancel().catch(() => {});
        text = new TextDecoder().decode(Buffer.concat(chunks, Math.min(bytes, MAX_READ_BYTES)));
      }
      return {
        status: res.status,
        contentType: res.headers.get('content-type') || '',
        body: text.slice(0, MAX_BODY_CHARS),
        ...((text.length > MAX_BODY_CHARS || bytes >= MAX_READ_BYTES) && { truncated: true }),
      };
    } finally {
      clearTimeout(timer);
    }
  });
}
