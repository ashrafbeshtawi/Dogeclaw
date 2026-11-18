// Text helpers for tool-call rendering. Tool output is untrusted, so it is
// only ever shown as text.

export const TOOL_ARGS_PREVIEW = 80;
export const TOOL_RESULT_PREVIEW = 300;

export function trimText(text: string, max: number) {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

// Arguments arrive parsed (objects) from our providers, but a raw JSON string
// is possible; parse it so the modal can pretty-print either way.
export function toolValueText(value: unknown, isPretty: boolean): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') {
    let parsed: unknown;
    try { parsed = JSON.parse(value); } catch { return value; }
    if (typeof parsed === 'string') return parsed;
    value = parsed;
  }
  return isPretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
}

export type ToolCall = { name: string; args: unknown; result?: unknown; hasResult: boolean };

// Calls run one after another in the order the model listed them, and a
// result only carries the tool name — so it belongs to the oldest pending
// call with that name.
export function attachResult(calls: ToolCall[], name: string, result: unknown): ToolCall[] {
  const i = calls.findIndex((c) => !c.hasResult && c.name === name);
  if (i === -1) return calls;
  return calls.map((c, j) => (j === i ? { ...c, result, hasResult: true } : c));
}
