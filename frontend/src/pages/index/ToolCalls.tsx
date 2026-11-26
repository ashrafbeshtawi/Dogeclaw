import { useEffect, useState } from 'react';
import { CodeBlock } from '@/components/ui/code-block';
import { TOOL_ARGS_PREVIEW, TOOL_RESULT_PREVIEW, toolValueText, trimText, type ToolCall } from './toolCalls';

//   ▸ 🔧 Tools (2): web_search, fetch_page        ← outer block, collapsed
//       ▸ web_search {"query":"dogecoin pr…"}  👁   ← one row per call, collapsed
//           {"results":[{"title":"…              ← trimmed result when opened
//
// The eye button opens the tool-call modal with the full arguments and result.
export function ToolCallsBlock({ calls, isLive, onInspect }: { calls: ToolCall[]; isLive: boolean; onInspect: (call: ToolCall) => void }) {
  // Open while the turn streams, folded away once it is done.
  const [isOpen, setOpen] = useState(isLive);
  useEffect(() => setOpen(isLive), [isLive]);

  return (
    <div className="thinking-block tool-calls">
      <div className="thinking-toggle" onClick={() => setOpen(!isOpen)}>
        {`🔧 Tools (${calls.length}): ${calls.map((c) => c.name).join(', ')}`}
      </div>
      <div className={`tool-call-list${isOpen ? ' open' : ''}`}>
        {calls.map((call, i) => <ToolCallRow key={i} call={call} onInspect={onInspect} />)}
      </div>
    </div>
  );
}

function ToolCallRow({ call, onInspect }: { call: ToolCall; onInspect: (call: ToolCall) => void }) {
  const [isOpen, setOpen] = useState(false);
  return (
    <div className={`tool-call${isOpen ? ' open' : ''}`}>
      <div className="tool-call-head">
        <button type="button" className="tool-call-toggle" onClick={() => setOpen(!isOpen)}>
          <span className="tool-call-name">{call.name}</span>
          <span className="tool-call-args">{trimText(toolValueText(call.args, false), TOOL_ARGS_PREVIEW)}</span>
        </button>
        <button type="button" className="tool-call-eye" title="Show full details" aria-label={`Show full details of ${call.name}`} onClick={() => onInspect(call)}>👁</button>
      </div>
      <pre className="tool-call-body">
        {call.hasResult ? trimText(toolValueText(call.result, true), TOOL_RESULT_PREVIEW) : 'Waiting for result…'}
      </pre>
    </div>
  );
}

export function ToolCallModal({ call, onClose }: { call: ToolCall | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={`modal-overlay${call ? ' open' : ''}`} id="toolCallModal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dc-modal tool-call-modal" role="dialog" aria-modal="true" aria-labelledby="toolCallModalTitle">
        <h3 id="toolCallModalTitle">{call?.name}</h3>
        <label>Arguments</label>
        <ToolValue id="toolCallModalArgs" text={call ? toolValueText(call.args, true) || '(none)' : ''} />
        <label>Result</label>
        <ToolValue id="toolCallModalResult" text={call?.hasResult ? toolValueText(call.result, true) : 'Waiting for result…'} />
        <div className="flex justify-end mt-4">
          <button className="btn btn-ghost btn-cancel" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function ToolValue({ id, text }: { id: string; text: string }) {
  const isJson = /^[[{]/.test(text);
  return (
    <CodeBlock
      id={id}
      code={text}
      language={isJson ? 'json' : 'text'}
      accent="#dc2626"
      mode="dark"
      showHeader={false}
      showLineNumbers={false}
      className="max-h-[35vh]"
    />
  );
}
