// Per-server MCP tool allowlist semantics:
//   allowed == null -> every tool the server offers (legacy file-era behavior)
//   allowed == []   -> none (fresh servers start here — explicit opt-in)
//   otherwise       -> exactly the named tools
//
// The allowlist exists because MCP servers routinely expose 20-40 verbose
// tool schemas, and small models measurably stop calling tools when every
// request carries a fat catalog. Own module so the null/[] semantics are
// unit-tested (see agent/test/mcpAllowlist.test.js).

export function filterAllowedTools(tools = [], allowed) {
  if (allowed == null) return tools;
  return tools.filter(t => allowed.includes(t.name));
}
