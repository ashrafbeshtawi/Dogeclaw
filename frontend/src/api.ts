// JSON fetch shared by the chat and admin pages. A 401 means the session
// cookie expired, so the browser goes back to the login page.
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
  return res.json();
}
