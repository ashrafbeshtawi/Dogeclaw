// Per-session async mutex. Serializes concurrent agent.run() invocations on
// the same session so they don't both read history version N and race to
// write back, dropping a turn. In-process only — fine while DogeClaw runs as
// a single Node process.

const queues = new Map();

export async function withSessionLock(sessionId, fn) {
  if (!sessionId) return fn();

  const prev = queues.get(sessionId) || Promise.resolve();
  let release;
  const ourTurn = new Promise(r => { release = r; });
  const newTail = prev.then(() => ourTurn);
  queues.set(sessionId, newTail);

  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (queues.get(sessionId) === newTail) queues.delete(sessionId);
  }
}
