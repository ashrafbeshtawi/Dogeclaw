// Presence check for request bodies, shared by the /api routers. Returns the
// same `{ error } | { fields }` shape as the xFieldsFromBody validators in
// routes/mcp.js and routes/searchEngines.js, so every POST/PUT handler reads:
//
//   const { error } = requireFields(req.body, ['name', 'model_id']);
//   if (error) return res.status(400).json({ error });
//
// A field counts as missing when it is falsy (undefined, null, '', 0, false),
// the same rule as the `if (!x)` chains this replaces. The error names every
// required field, not just the missing ones: "agent_id, type, and name required".

export function requireFields(body, names) {
  const source = body && typeof body === 'object' ? body : {};
  if (names.some(n => !source[n])) return { error: `${listNames(names)} required` };
  return { fields: Object.fromEntries(names.map(n => [n, source[n]])) };
}

function listNames(names) {
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
}
