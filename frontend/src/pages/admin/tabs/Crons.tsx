import { useState } from 'react';
import { api } from '@/api';
import { AnimatedCounter } from '@/components/ui/animated-counter';
import {
  DEFAULT_CRON_SORT, TIMEZONES, countCronViews, cronAgents, nextCronSort, selectCrons,
  type CronSortKey, type CronView, type Row,
} from '../data';
import { EmptyRow, Modal, OnOff, RowActions, TabHeader, Table, Toggle, editingKey, editingRow, text, write, type Editing, type TabProps } from '../ui';

const VIEWS: CronView[] = ['all', 'active', 'inactive', 'failing'];
const COLUMNS: [CronSortKey, string][] = [
  ['id', 'ID'], ['agent', 'Agent'], ['target', 'Target'], ['schedule', 'Schedule'],
  ['prompt', 'Prompt'], ['last', 'Last run'], ['enabled', 'Enabled'],
];

const isoMinutes = (date: string) => new Date(date).toISOString().replace('T', ' ').slice(0, 16);

function CronRow({ job, onEdit, onDelete }: { job: Row; onEdit: () => void; onDelete: () => void }) {
  const sessionId = String(job.session_id ?? '');
  return (
    <tr>
      <td>{job.id}</td>
      <td>{job.agent_name || '?'}</td>
      <td>
        {job.chat_id ? <>TG: <strong>{job.channel_name || '?'}</strong> / {job.chat_id}</>
          : job.session_id ? <>Web: <code>{sessionId.slice(0, 16) + (sessionId.length > 16 ? '…' : '')}</code></>
          : '?'}
      </td>
      <td>
        {job.expression ? <code>{job.expression}</code> : 'at ' + new Date(job.run_at).toISOString()}
        {job.timezone && job.timezone !== 'UTC' && <span className="opacity-50 text-[0.7rem]"> {job.timezone}</span>}
      </td>
      <td>
        <div className="max-w-[240px] truncate">{job.prompt || ''}</div>
        {job.description && <div className="cron-desc text-[0.7rem] opacity-50 max-w-[240px] truncate">{job.description}</div>}
      </td>
      <td>
        {job.last_run_at
          ? <><span className={`badge ${job.last_status === 'ok' ? 'badge-on' : 'badge-off'}`}>{job.last_status || '?'}</span> <span className="opacity-50 text-[0.7rem]">{isoMinutes(job.last_run_at)}</span></>
          : <span className="opacity-40">never</span>}
      </td>
      <td><OnOff isOn={job.enabled} /></td>
      <RowActions onEdit={onEdit} onDelete={onDelete} />
    </tr>
  );
}

export function Crons({ data, reload }: TabProps) {
  const [view, setView] = useState<CronView>('all');
  const [sort, setSort] = useState(DEFAULT_CRON_SORT);
  const [agentFilter, setAgentFilter] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  const [targetType, setTargetType] = useState('telegram');
  const [scheduleType, setScheduleType] = useState('recurring');
  const job = editingRow(editing);

  const counts = countCronViews(data.crons);
  const agents = cronAgents(data.crons);
  // A pick whose agent no longer has any job falls back to all agents.
  const agentPick = agents.some((a) => String(a.id) === agentFilter) ? agentFilter : '';
  const shown = selectCrons(data.crons, view, agentPick, query, sort);

  function open(j: Editing) {
    const row = editingRow(j);
    setTargetType(row?.session_id ? 'web' : 'telegram');
    setScheduleType(row?.run_at ? 'one_shot' : 'recurring');
    setEditing(j);
  }

  async function save(form: FormData) {
    const runAt = text(form, 'cronRunAt');
    const body: Record<string, unknown> = {
      timezone: text(form, 'cronTimezone') || null,
      description: text(form, 'cronDescription'),
      prompt: text(form, 'cronPrompt'),
      enabled: form.has('cronEnabled'),
      expression: scheduleType === 'recurring' ? text(form, 'cronExpression') : null,
      run_at: scheduleType === 'recurring' || !runAt ? null : new Date(runAt).toISOString(),
    };
    // The target is fixed once a job exists.
    if (!job) {
      body.agent_id = parseInt(text(form, 'cronAgent'));
      const isTelegram = targetType === 'telegram';
      body.channel_id = isTelegram ? parseInt(text(form, 'cronChannel')) : null;
      body.chat_id = isTelegram ? text(form, 'cronChatId') : null;
      body.session_id = isTelegram ? null : text(form, 'cronSession');
    }
    const request = job ? api('PUT', '/api/cron-jobs/' + job.id, body) : api('POST', '/api/cron-jobs', body);
    if (await write(request, reload, 'Cron job saved')) setEditing(null);
  }

  async function remove(id: number) {
    if (!confirm('Delete this cron job?')) return;
    await write(api('DELETE', '/api/cron-jobs/' + id), reload);
  }

  const isEditing = !!job;

  return (
    <>
      <TabHeader title="Cron Jobs" onNew={() => open('new')} newLabel="+ New Job">
        <div className="flex flex-wrap gap-1.5" id="cronViewTabs">
          {VIEWS.map((v) => (
            <button key={v} data-cron-view={v} onClick={() => setView(v)}
              className={`btn btn-sm ${v === view ? 'btn-primary' : 'btn-ghost border border-white/10'}`}>
              <span>{v[0].toUpperCase() + v.slice(1)} (<AnimatedCounter value={counts[v]} />)</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto lg:ml-auto">
          <select id="cronAgentFilter" className="select select-sm flex-1 sm:flex-none sm:w-40" value={agentPick} onChange={(e) => setAgentFilter(e.target.value)}>
            <option value="">All agents</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <input type="text" id="cronFilterInput" placeholder="Filter agent, target, prompt…" className="input input-sm flex-1 sm:flex-none sm:w-56"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </TabHeader>
      <Table bodyId="cronsTable" head={
        <thead><tr className="cursor-pointer select-none">
          {COLUMNS.map(([key, label]) => (
            <th key={key} className="cron-sort" data-cron-sort={key} onClick={() => setSort(nextCronSort(sort, key))}>
              {label}{sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
            </th>
          ))}
          <th className="cursor-default"></th>
        </tr></thead>
      }>
        {shown.length === 0 && <EmptyRow colSpan={8}>No jobs match.</EmptyRow>}
        {shown.map((j) => <CronRow key={j.id} job={j} onEdit={() => open(j)} onDelete={() => remove(j.id)} />)}
      </Table>
      <div className="hint">Recurring uses standard cron syntax. One-shots auto-disable after firing. Web-session jobs are deleted with their session; channel jobs survive session resets.</div>

      <Modal id="cronModal" title={isEditing ? 'Edit Cron Job' : 'New Cron Job'} isOpen={!!editing} formKey={editingKey(editing)}
        onClose={() => setEditing(null)} onSave={save}>
        <label>Agent</label>
        <select id="cronAgent" name="cronAgent" disabled={isEditing} defaultValue={job?.agent_id ?? data.agents[0]?.id}>
          {data.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>

        <label>Target type</label>
        <select id="cronTargetType" disabled={isEditing} value={targetType} onChange={(e) => setTargetType(e.target.value)}>
          <option value="telegram">Telegram channel + chat</option>
          <option value="web">Web session</option>
        </select>

        <div id="cronTelegramFields" style={{ display: targetType === 'telegram' ? 'block' : 'none' }}>
          <label>Telegram channel</label>
          <select id="cronChannel" name="cronChannel" disabled={isEditing} defaultValue={job?.channel_id}>
            {data.channels.filter((c) => c.type === 'telegram').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label>Chat ID</label>
          <input type="text" id="cronChatId" name="cronChatId" placeholder="123456789" disabled={isEditing} defaultValue={job?.chat_id ?? ''} />
          <div className="field-hint">Numeric Telegram chat id this job will push messages to.</div>
        </div>

        <div id="cronWebFields" style={{ display: targetType === 'web' ? 'block' : 'none' }}>
          <label>Web session</label>
          <select id="cronSession" name="cronSession" disabled={isEditing} defaultValue={job?.session_id}>
            {data.sessions.map((s) => <option key={s.id} value={s.id}>{s.id} — {s.agentName || '?'}</option>)}
          </select>
          <div className="field-hint">Job is deleted when the session is deleted. No push notification — reply appears next time the user opens the session.</div>
        </div>

        <label>Schedule type</label>
        <select id="cronScheduleType" value={scheduleType} onChange={(e) => setScheduleType(e.target.value)}>
          <option value="recurring">Recurring (cron)</option>
          <option value="one_shot">One-shot</option>
        </select>

        <div id="cronExpressionField" style={{ display: scheduleType === 'recurring' ? 'block' : 'none' }}>
          <label>Cron expression</label>
          <input type="text" id="cronExpression" name="cronExpression" placeholder="0 9 * * *" defaultValue={job?.expression ?? ''} />
          <div className="field-hint">e.g. <code>*/30 * * * *</code> every 30 min, <code>0 9 * * *</code> daily 09:00.</div>
        </div>

        <div id="cronRunAtField" style={{ display: scheduleType === 'one_shot' ? 'block' : 'none' }}>
          <label>Run at</label>
          <input type="datetime-local" id="cronRunAt" name="cronRunAt" defaultValue={job?.run_at ? new Date(job.run_at).toISOString().slice(0, 16) : ''} />
          <div className="field-hint">One-shot. Auto-disabled after firing. Interpreted in the timezone below.</div>
        </div>

        <label>Timezone</label>
        <select id="cronTimezone" name="cronTimezone" defaultValue={job ? job.timezone || 'UTC' : data.settings.timezone || 'UTC'}>
          {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
        </select>

        <label>Description (optional)</label>
        <input type="text" id="cronDescription" name="cronDescription" placeholder="Morning check-in" defaultValue={job?.description ?? ''} />

        <label>Prompt</label>
        <textarea id="cronPrompt" name="cronPrompt" placeholder="Instruction given to the agent when the job fires..." defaultValue={job?.prompt ?? ''} />

        <Toggle id="cronEnabled" label="Enabled" defaultChecked={job ? job.enabled !== false : true} />
        {isEditing && <div className="field-hint text-accent" id="cronEditHint">Target (agent, channel/session, chat id) cannot be changed after creation.</div>}
      </Modal>
    </>
  );
}
