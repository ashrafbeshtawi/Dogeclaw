import '@/app.css';
import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PromptBox } from '@/components/ui/prompt-box';
import { AiStatus } from '@/components/ui/ai-status';
import { StreamingResponse } from '@/components/ui/streaming-response';
import FluidOrb from '@/components/ui/fluid-orb';
import { Toaster, toast } from '@/components/ui/toast';
import { RareUiCredit } from '@/RareUiCredit';
import { api, listOf } from '@/api';
import { ToolCallModal, ToolCallsBlock } from './ToolCalls';
import { attachResult, type ToolCall } from './toolCalls';
import { updateByKey } from './messages';

type Agent = { id: number; name: string; model_id: number | null };
type Session = { id: string; source?: string; preview?: string };
type Chip = { icon: string; label: string };
type Message = {
  key: number;
  role: 'user' | 'assistant';
  content: string;
  chips?: Chip[];
  thinking?: string;
  toolCalls?: ToolCall[];
  // Set while the reply streams: what the agent is doing right now.
  live?: { state: string; label: string } | null;
};

let nextKey = 0;
const userMessage = (content: string, chips?: Chip[]): Message => ({ key: nextKey++, role: 'user', content, chips });

// Same three steps the agent reports over SSE, mapped onto AiStatus states.
const BUSY = { state: 'thinking', label: 'Processing...' };

function Chat() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [hasModels, setHasModels] = useState(true);
  const [isLoaded, setLoaded] = useState(false);
  const [agentId, setAgentId] = useState<number | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [isSending, setSending] = useState(false);
  const [isRecording, setRecording] = useState(false);
  const [inspected, setInspected] = useState<ToolCall | null>(null);
  // Below md the sidebar is a drawer.
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const messagesEl = useRef<HTMLDivElement>(null);
  // The reply that is streaming right now, so it can be stopped or dropped.
  const activeReply = useRef<{ key: number; controller: AbortController } | null>(null);

  const closeInspector = useCallback(() => setInspected(null), []);
  const previewUrl = useMemo(() => (pendingFile?.type.startsWith('image/') ? URL.createObjectURL(pendingFile) : null), [pendingFile]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const usableAgents = agents.filter((a) => a.model_id);
  const isReady = hasModels && usableAgents.length > 0;

  async function loadAgents() {
    const [agentData, modelData] = await Promise.all([api('GET', '/api/agents'), api('GET', '/api/models')]);
    const list = listOf<Agent>(agentData, 'agents');
    setAgents(list);
    setHasModels(listOf(modelData, 'models').length > 0);
    setAgentId((current) => current ?? list.find((a) => a.model_id)?.id ?? null);
    setLoaded(true);
  }

  const loadSessions = useCallback(async () => {
    const data = await api('GET', '/api/sessions');
    setSessions(listOf(data, 'sessions'));
  }, []);

  useEffect(() => { loadAgents(); loadSessions(); }, []);

  useEffect(() => {
    const el = messagesEl.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Stops reading the streaming reply; its remaining events are dropped.
  function stopStream() {
    const current = activeReply.current;
    if (!current) return;
    current.controller.abort();
    activeReply.current = null;
    setSending(false);
    // Still shown (Stop button): keep what arrived and end the live status.
    setMessages((list) => updateByKey(list, current.key, () => ({ live: null })));
  }

  function newSession() {
    stopStream();
    setDrawerOpen(false);
    setSessionId(null);
    setMessages([]);
    loadSessions();
  }

  async function switchSession(id: string) {
    stopStream();
    setDrawerOpen(false);
    setSessionId(id);
    const res = await fetch('/api/sessions/' + id);
    if (!res.ok) return;
    const data = await res.json();
    if (data.agentId) setAgentId(data.agentId);
    setMessages((data.messages || []).flatMap((msg: any): Message[] => {
      if (msg.role === 'user') {
        // Media chips are informational — the media itself is not stored.
        const chips: Chip[] = [];
        if (msg.hasAudio) chips.push({ icon: '🎤', label: 'voice message' });
        if (msg.hasImage) chips.push({ icon: '📷', label: 'image' });
        if (msg.hasVideo) chips.push({ icon: '🎬', label: 'video' });
        return [userMessage(msg.content || '', chips)];
      }
      if (msg.role === 'assistant') {
        const toolCalls = (msg.toolCalls || []).map((tc: any) => ({ name: tc.name, args: tc.args, result: tc.result, hasResult: true }));
        return [{ key: nextKey++, role: 'assistant', content: msg.content, thinking: msg.thinking, toolCalls }];
      }
      return [];
    }));
    loadSessions();
  }

  async function deleteSession(id: string) {
    try {
      const data = await api('GET', '/api/sessions/' + id + '/crons');
      const jobs = data.jobs || [];
      if (jobs.length > 0) {
        const msg = 'This session has ' + jobs.length + ' scheduled job(s) attached:\n'
          + jobs.map((j: any) => {
            const s = j.expression ? 'cron ' + j.expression : 'at ' + new Date(j.run_at).toISOString();
            return '  #' + j.id + ' (' + s + ')' + (j.description ? ' — ' + j.description : '');
          }).join('\n')
          + '\n\nDeleting the session will also delete these jobs. Continue?';
        if (!confirm(msg)) return;
      }
    } catch {}
    await fetch('/api/sessions/' + id, { method: 'DELETE' });
    if (sessionId === id) newSession();
    else loadSessions();
  }

  async function toggleRecording() {
    if (recorder.current?.state === 'recording') {
      recorder.current.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: rec.mimeType });
        const file = new File([blob], 'recording.webm', { type: rec.mimeType });
        // onstop runs long after this render: go through the ref for the
        // current session, agent and streaming state.
        if (activeReply.current) {
          setPendingFile(file);
          toast('Voice message attached, send it once the reply is done');
        } else {
          sendRef.current('', file);
        }
      };
      rec.start();
      recorder.current = rec;
      setRecording(true);
    } catch {
      toast.error('Microphone access denied');
    }
  }

  function clearFile() {
    setPendingFile(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function send(text: string, file: File | null = pendingFile) {
    text = text.trim();
    if (activeReply.current || (!text && !file)) return;
    setInput('');
    const isAudio = !!file && file.type.startsWith('audio/');
    const isImage = !!file && file.type.startsWith('image/');
    const sent: Message[] = [];
    if (text) sent.push(userMessage(text));
    if (isImage) sent.push(userMessage('[image: ' + file!.name + ']'));
    if (isAudio) sent.push(userMessage('[voice message]'));
    const replyKey = nextKey++;
    const own = { key: replyKey, controller: new AbortController() };
    activeReply.current = own;
    const isCurrent = () => activeReply.current === own;
    // Changes this reply only while it is still the one streaming.
    const updateReply = (change: (reply: Message) => Partial<Message>) => {
      if (isCurrent()) setMessages((list) => updateByKey(list, replyKey, change));
    };
    setMessages((list) => [...list, ...sent, { key: replyKey, role: 'assistant', content: '', live: BUSY }]);
    setSending(true);

    let images = null, audio = null, audioMime = null;
    if (isImage) images = [await fileToBase64(file!)];
    else if (isAudio) { audio = await fileToBase64(file!); audioMime = file!.type; }
    clearFile();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId, agentId, images, audio, audioMime }),
        signal: own.controller.signal,
      });
      if (res.status === 401) { window.location.href = '/login'; return; }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '', eventType: string | null = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop()!;
        for (const line of lines) {
          if (line.startsWith('event: ')) { eventType = line.slice(7); continue; }
          if (!line.startsWith('data: ') || !eventType) continue;
          if (isCurrent()) onEvent(eventType, JSON.parse(line.slice(6)), updateReply);
          eventType = null;
        }
      }
      updateReply(() => ({ live: null }));
    } catch (err: any) {
      // A stopped stream (Stop button, session switch) is not an error.
      if (!own.controller.signal.aborted) updateReply(() => ({ content: 'Error: ' + err.message, live: null }));
    } finally {
      if (isCurrent()) {
        activeReply.current = null;
        setSending(false);
      }
    }
  }
  const sendRef = useRef(send);
  sendRef.current = send;

  function onEvent(type: string, data: any, updateReply: (change: (reply: Message) => Partial<Message>) => void) {
    if (type === 'status') updateReply((r) => ({ live: { state: r.live?.state ?? 'thinking', label: data } }));
    else if (type === 'thinking') updateReply((r) => ({ thinking: (r.thinking || '') + data, live: { state: 'thinking', label: 'Thinking...' } }));
    else if (type === 'content') updateReply((r) => ({ content: r.content + data, live: { state: 'writing', label: 'Generating...' } }));
    else if (type === 'tool_calls') {
      const names = data.map((tc: any) => tc.function.name);
      updateReply((r) => ({
        toolCalls: [...(r.toolCalls || []), ...data.map((tc: any) => ({ name: tc.function.name, args: tc.function.arguments, hasResult: false }))],
        live: { state: 'researching', label: 'Using: ' + names.join(', ') },
      }));
    } else if (type === 'tool_result') {
      updateReply((r) => ({ toolCalls: attachResult(r.toolCalls || [], data.name, data.result), live: { state: 'analyzing', label: 'Got result from ' + data.name } }));
    } else if (type === 'done') {
      setSessionId(data.sessionId);
      loadSessions();
    } else if (type === 'error') {
      updateReply(() => ({ content: 'Error: ' + data.message }));
    }
  }

  async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  const placeholder = !isLoaded || isReady ? 'Message DogeClaw...'
    : !hasModels ? 'Add a model in admin first...' : 'Assign a model to an agent in admin...';

  return (
    <div className="h-dvh flex bg-base-200 text-base-content overflow-hidden">
      {isDrawerOpen && <div className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden" style={{ animation: 'dc-fade-in 0.2s' }} onClick={() => setDrawerOpen(false)} />}
      <div className={`fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] bg-base-100 border-r border-primary/10 flex flex-col shrink-0 transition-transform duration-300 md:static md:translate-x-0 ${isDrawerOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="px-5 pt-6 pb-4 border-b border-white/5 flex flex-col items-center gap-2 text-center">
          <img src="/static/logo.png" alt="DogeClaw" className="login-logo w-32 transition-transform hover:scale-105" />
          <h2 className="text-xl font-extrabold tracking-tight bg-gradient-to-br from-white to-accent bg-clip-text text-transparent">DogeClaw</h2>
        </div>
        <div className="p-3 flex flex-col gap-2 border-b border-white/5">
          <select id="agentSelect" className="select w-full" disabled={isLoaded && !isReady}
            value={isReady ? agentId ?? '' : ''} onChange={(e) => setAgentId(parseInt(e.target.value))}>
            {isLoaded && !isReady
              ? <option value="">(no agents)</option>
              : usableAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button className="new-chat-btn" onClick={newSession}>+ New Chat</button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1" id="sessions">
          {sessions.map((s) => (
            <div key={s.id} className={`session-item${s.id === sessionId ? ' active' : ''}`} onClick={() => switchSession(s.id)}>
              {s.source === 'telegram' && <span className="src">TG</span>}
              <span className="session-label">{s.preview || s.id.slice(0, 8) + '...'}</span>
              <span className="del" onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}>&times;</span>
            </div>
          ))}
        </div>
        <div className="p-3 border-t border-white/5 flex gap-2">
          <a href="/admin" className="btn btn-ghost flex-1 border border-white/10 text-base-content/80">Admin</a>
          <button onClick={logout} className="btn btn-ghost flex-1 border border-white/10 text-base-content/80">Logout</button>
        </div>
        <RareUiCredit />
      </div>

      <div className="dc-ambient flex-1 flex flex-col min-w-0">
        <div className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-white/5 bg-base-100/80 backdrop-blur">
          <button className="btn btn-ghost btn-square" aria-label="Open sessions" onClick={() => setDrawerOpen(true)}>
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <img src="/static/logo.png" alt="" className="w-12 -my-2" />
          <span className="font-extrabold tracking-tight bg-gradient-to-br from-white to-accent bg-clip-text text-transparent">DogeClaw</span>
          <span className="ml-auto text-xs text-base-content/50 truncate">{usableAgents.find((a) => a.id === agentId)?.name}</span>
        </div>
        <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 flex flex-col gap-4" id="messages" ref={messagesEl}>
          {isLoaded && !isReady && <SetupState hasModels={hasModels} />}
          {(!isLoaded || isReady) && messages.length === 0 && (
            <div className="empty-state" id="emptyState">
              <div className="relative grid place-items-center mb-8">
                <FluidOrb size={260} color="#dc2626" className="absolute opacity-80 shadow-[0_0_90px_rgba(220,38,38,0.45)] max-w-[45vw] max-h-[45vw]" />
                <img src="/static/logo.png" alt="" className="relative !mb-0" />
              </div>
              <p>Start a conversation</p>
            </div>
          )}
          {messages.map((m) => (m.role === 'user'
            ? <UserBubble key={m.key} message={m} />
            : <AssistantBubble key={m.key} message={m} onInspect={setInspected} />))}
        </div>

        {pendingFile && (
          <div className="px-4 md:px-8 py-2 flex items-center gap-2 text-sm text-base-content/70" id="filePreview">
            {previewUrl && <img src={previewUrl} alt="" className="max-h-16 rounded-md" />}
            <span>{pendingFile.name}</span>
            <span className="remove cursor-pointer text-error ml-auto" onClick={clearFile}>&times;</span>
          </div>
        )}
        <div className="px-3 md:px-8 pb-4 md:pb-5 pt-3 md:pt-4 border-t border-white/5 flex justify-center">
          <PromptBox
            className="w-full max-w-3xl"
            value={input}
            onValueChange={setInput}
            onSubmit={(text) => send(text)}
            status={isSending ? 'streaming' : 'idle'}
            onStop={stopStream}
            disabled={isLoaded && !isReady}
            allowEmpty={!!pendingFile}
            placeholder={placeholder}
            efforts={[{ id: 'send', label: 'Send', color: '#dc2626' }]}
            hint={null}
            inputProps={{ id: 'input' }}
            actions={<>
              <button type="button" className="media-btn btn btn-square btn-ghost text-xl" title="Attach file" onClick={() => fileInput.current?.click()}>📎</button>
              <input type="file" ref={fileInput} id="fileInput" accept="image/*,audio/*" className="hidden"
                onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)} />
              <button type="button" className={`media-btn btn btn-square btn-ghost text-xl${isRecording ? ' recording' : ''}`} id="micBtn" title="Record voice" onClick={toggleRecording}>🎤</button>
            </>}
          />
        </div>
      </div>

      <ToolCallModal call={inspected} onClose={closeInspector} />
      <Toaster />
    </div>
  );
}

function SetupState({ hasModels }: { hasModels: boolean }) {
  return (
    <div className="empty-state">
      <img src="/static/logo.png" alt="" />
      <p className="mb-4">
        {!hasModels
          ? 'No models configured yet. Add one in the admin to start chatting.'
          : 'You have models but no agent uses them. Assign a model to an agent in the admin.'}
      </p>
      <a href="/admin" className="new-chat-btn max-w-[200px] text-center !border-solid">Open Admin</a>
    </div>
  );
}

function UserBubble({ message }: { message: Message }) {
  return (
    <div className="msg user">
      {message.chips?.map((chip) => <span key={chip.label}><span className="media-chip">{chip.icon} {chip.label}</span><br /></span>)}
      <span>{message.content}</span>
    </div>
  );
}

function AssistantBubble({ message, onInspect }: { message: Message; onInspect: (call: ToolCall) => void }) {
  const isLive = !!message.live;
  return (
    <div className={`msg assistant${isLive ? ' streaming' : ''}`}>
      {isLive && (
        <div className="status-row">
          <AiStatus state={message.live!.state} label={message.live!.label} shimmer />
        </div>
      )}
      {message.thinking && <ThinkingBlock text={message.thinking} isLive={isLive} />}
      {!!message.toolCalls?.length && <ToolCallsBlock calls={message.toolCalls} isLive={isLive} onInspect={onInspect} />}
      {(message.content || !isLive) && <StreamingResponse text={message.content} status={isLive ? 'streaming' : 'done'} actions={false} className="text-[0.9rem] leading-relaxed" />}
    </div>
  );
}

function ThinkingBlock({ text, isLive }: { text: string; isLive: boolean }) {
  const [isOpen, setOpen] = useState(isLive);
  useEffect(() => setOpen(isLive), [isLive]);
  return (
    <div className="thinking-block">
      <div className="thinking-toggle" onClick={() => setOpen(!isOpen)}>▸ {isLive ? 'Thinking...' : 'Thinking'}</div>
      <div className={`thinking-content${isOpen ? ' open' : ''}`}>{text}</div>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(file);
  });
}

createRoot(document.getElementById('root')!).render(<Chat />);
