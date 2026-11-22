// A streaming reply is updated by its key, not by position: after a session
// switch the list holds other messages, and a late event must not land on them.
export function updateByKey<T extends { key: number }>(list: T[], key: number, change: (m: T) => Partial<T>): T[] {
  if (!list.some((m) => m.key === key)) return list;
  return list.map((m) => (m.key === key ? { ...m, ...change(m) } : m));
}
