// Pure helpers around tool-usage indicators — both derived from the actual
// calls made, never from the model's own claims.
//
// toolIcons/appendToolIcons: the 🗄️/🔧 status line used to be a system-prompt
// rule the model had to follow itself; models imitated stale history and
// claimed tool use that never happened. Now the line is appended
// mechanically from the collected tool calls of THIS turn. Icon-only lines
// (and "[used tools: ...]" traces) the model imitated from replayed history
// are stripped first, so the appended line is the single source of truth.
//
// toolTrace: the compact suffix added to past assistant turns when history
// is replayed to the model (see agent.js) — without it, the model sees only
// its own claims ("saved it!") with the tool call edited out, and learns to
// claim without calling.
//
// Own module so it can be unit-tested in isolation (see
// agent/test/toolIcons.test.js).

const ICON_LINE = /\n[\s🗄️🔧]+$/u;
const TRACE_LINE = /\n\[used tools: [^\]]*\]\s*$/;

export function toolIcons(toolCalls = []) {
  const db = toolCalls.some(t => t.name === 'database' || t.name === 'query_database');
  const other = toolCalls.some(t => t.name !== 'database' && t.name !== 'query_database');
  return `${db ? '🗄️' : ''}${other ? '🔧' : ''}`;
}

export function appendToolIcons(content, toolCalls = []) {
  // Strip until stable — the model may stack an imitated trace line and an
  // icon line in either order.
  let cleaned = content || '';
  for (let prev; prev !== cleaned; ) {
    prev = cleaned;
    cleaned = cleaned.replace(TRACE_LINE, '').replace(ICON_LINE, '');
  }
  cleaned = cleaned.trimEnd();
  const icons = toolIcons(toolCalls);
  if (!icons) return cleaned;
  return cleaned ? `${cleaned}\n\n${icons}` : icons;
}

export function toolTrace(toolCalls = []) {
  const names = [...new Set(toolCalls.map(t => t.name))];
  return names.length ? `[used tools: ${names.join(', ')}]` : '';
}
