import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/api';
import { eventPreview, findById, type Row } from '../data';
import { EmptyRow, TabHeader, Table, write } from '../ui';

function Block({ title, tone = '', children }: { title: string; tone?: string; children: string }) {
  return (
    <div className="mt-3">
      <strong>{title}</strong>
      <pre className={`whitespace-pre-wrap p-2.5 rounded-md mt-1 max-h-[220px] overflow-auto ${tone || 'bg-white/[0.03]'}`}>{children}</pre>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><strong>{label}:</strong> {children}</div>;
}

// Loaded on its own, not with the rest of the admin data: the log can be
// long and is only needed while this tab is open.
export function Events({ retentionDays }: { retentionDays: number }) {
  const [kind, setKind] = useState('');
  const [events, setEvents] = useState<Row[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = openId ? findById(events, openId) : undefined;

  const load = useCallback(async () => {
    const r = await api('GET', '/api/event-logs' + (kind ? '?kind=' + encodeURIComponent(kind) : ''));
    setEvents(r?.logs || []);
  }, [kind]);
  useEffect(() => { load(); }, [load]);

  async function remove(id: unknown) {
    if (!confirm('Delete this event log entry?')) return;
    if (await write(api('DELETE', '/api/event-logs/' + id), load)) setOpenId(null);
  }

  async function clear() {
    const label = kind ? 'all "' + kind + '" entries' : 'ALL event log entries';
    if (!confirm('Delete ' + label + '? This cannot be undone.')) return;
    await write(api('DELETE', '/api/event-logs' + (kind ? '?kind=' + encodeURIComponent(kind) : '')), load);
  }

  return (
    <>
      <TabHeader title="Events">
        <select id="eventsKindFilter" className="select select-sm w-40" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All kinds</option>
          <option value="cron_run">Cron runs</option>
        </select>
        <button className="btn btn-ghost btn-sm border border-white/10" onClick={load}>Refresh</button>
        <button className="btn btn-outline btn-error btn-sm danger" onClick={clear}>Clear filtered</button>
      </TabHeader>
      <Table bodyId="eventsTable" head={<thead><tr><th>When</th><th>Kind</th><th>Status</th><th>Ref</th><th>Duration</th><th>Preview</th><th></th></tr></thead>}>
        {events.length === 0 && <EmptyRow colSpan={7}>No events yet.</EmptyRow>}
        {events.map((ev) => (
          // BIGSERIAL ids come back from pg as strings.
          <tr key={ev.id} className="cursor-pointer" onClick={() => setOpenId(String(ev.id))}>
            <td className="whitespace-nowrap">{new Date(ev.created_at).toLocaleString()}</td>
            <td><span className="badge badge-tag">{ev.kind}</span></td>
            <td><span className={`badge ${ev.status === 'success' ? 'badge-on' : 'badge-off'}`}>{ev.status}</span></td>
            <td><code>{ev.ref_id || ''}</code></td>
            <td>{ev.duration_ms != null ? ev.duration_ms + ' ms' : '—'}</td>
            <td className="max-w-[280px] truncate">{eventPreview(ev)}</td>
            <td className="actions"><button className="danger" onClick={(e) => { e.stopPropagation(); remove(ev.id); }}>Delete</button></td>
          </tr>
        ))}
      </Table>
      <div className="hint">Auto-pruned after <code id="eventsRetentionLabel">{retentionDays}</code> day(s) by the background cleanup tick. Adjust on the Settings tab.</div>

      <div className={`modal-overlay${opened ? ' open' : ''}`} id="eventModal">
        <div className="dc-modal max-w-[720px]">
          <h3 id="eventModalTitle">{opened ? 'Event #' + opened.id : 'Event'}</h3>
          <div id="eventModalBody" className="text-[0.82rem] text-base-content/80">
            {opened && <>
              <Field label="ID">{opened.id}</Field>
              <Field label="When">{new Date(opened.created_at).toLocaleString()}</Field>
              <Field label="Kind">{opened.kind}</Field>
              <Field label="Status">{opened.status}</Field>
              {opened.ref_id && <Field label="Ref"><code>{opened.ref_id}</code></Field>}
              {opened.duration_ms != null && <Field label="Duration">{opened.duration_ms} ms</Field>}
              {opened.input && <Block title="Input">{opened.input}</Block>}
              {opened.output && <Block title="Output">{opened.output}</Block>}
              {opened.error && <Block title="Error" tone="bg-error/5 text-accent">{opened.error}</Block>}
              {opened.meta && Object.keys(opened.meta).length > 0 && <Block title="Meta">{JSON.stringify(opened.meta, null, 2)}</Block>}
            </>}
          </div>
          <div className="btn-row">
            <button className="btn btn-ghost border border-white/10 btn-cancel" onClick={() => setOpenId(null)}>Close</button>
            <button className="btn btn-outline btn-error danger" id="eventDeleteBtn" onClick={() => remove(opened?.id)}>Delete</button>
          </div>
        </div>
      </div>
    </>
  );
}
