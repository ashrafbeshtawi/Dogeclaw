// JSON fetch shared by the chat and admin pages. A 401 means the session
// cookie expired, so the browser goes back to the login page. A reply that is
// not JSON (e.g. a proxy's 502 page) comes back as { error } like the API's
// own failures, so callers and write() handle both the same way.
export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    window.location.href = '/login';
    return new Promise(() => {});
  }
  return res.json().catch(() => ({ error: res.statusText || 'HTTP ' + res.status }));
}

// The array at body[key], or [] when the request failed and body is an
// { error } object, so one broken endpoint leaves its list empty instead of
// crashing the whole page on the next .map.
export function listOf<T = any>(body: unknown, key: string): T[] {
  const value = (body as Record<string, unknown> | null | undefined)?.[key];
  return Array.isArray(value) ? (value as T[]) : [];
}
