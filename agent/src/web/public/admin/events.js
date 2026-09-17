import { state, api, esc, find, closeModal } from './store.js';

export async function loadEvents() {
    var kind = document.getElementById('eventsKindFilter').value;
    var qs = kind ? ('?kind=' + encodeURIComponent(kind)) : '';
    var r = await api('GET', '/api/event-logs' + qs);
    state.events = (r && r.logs) || [];
    renderEvents();
}

export function eventPreview(ev) {
    if (ev.status === 'error') return ev.error || '(no error message)';
    var src = ev.output || ev.input || '';
    return String(src).replace(/\s+/g, ' ').slice(0, 80);
}

export function renderEvents() {
    var rows = state.events.map(function(ev) {
        var when = new Date(ev.created_at).toLocaleString();
        var statusBadge = '<span class="badge badge-sm ' + (ev.status === 'success' ? 'badge-on' : 'badge-off') + '">' + esc(ev.status) + '</span>';
        var dur = ev.duration_ms != null ? (ev.duration_ms + ' ms') : '—';
        return '<tr style="cursor:pointer" onclick="openEventDetail(' + ev.id + ')">'
            + '<td style="white-space:nowrap">' + esc(when) + '</td>'
            + '<td><span class="badge badge-sm badge-tag">' + esc(ev.kind) + '</span></td>'
            + '<td>' + statusBadge + '</td>'
            + '<td><code>' + esc(ev.ref_id || '') + '</code></td>'
            + '<td>' + esc(dur) + '</td>'
            + '<td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(eventPreview(ev)) + '</td>'
            + '<td class="actions"><button class="danger" onclick="event.stopPropagation();deleteEvent(' + ev.id + ')">Delete</button></td>'
            + '</tr>';
    }).join('');
    document.getElementById('eventsTable').innerHTML = rows || '<tr><td colspan="7" style="opacity:0.4;text-align:center;padding:1.5rem">No events yet.</td></tr>';
}

export function openEventDetail(id) {
    // BIGSERIAL ids come back from pg as strings; the onclick interpolates
    // them unquoted so we receive a JS number — coerce both sides.
    var ev = state.events.find(function(e){return String(e.id) === String(id);});
    if (!ev) return;
    var body = '';
    body += '<div><strong>ID:</strong> ' + esc(ev.id) + '</div>';
    body += '<div><strong>When:</strong> ' + esc(new Date(ev.created_at).toLocaleString()) + '</div>';
    body += '<div><strong>Kind:</strong> ' + esc(ev.kind) + '</div>';
    body += '<div><strong>Status:</strong> ' + esc(ev.status) + '</div>';
    if (ev.ref_id) body += '<div><strong>Ref:</strong> <code>' + esc(ev.ref_id) + '</code></div>';
    if (ev.duration_ms != null) body += '<div><strong>Duration:</strong> ' + esc(ev.duration_ms) + ' ms</div>';
    if (ev.input) body += '<div style="margin-top:0.75rem"><strong>Input</strong><pre style="white-space:pre-wrap;background:rgba(255,255,255,0.03);padding:0.6rem;border-radius:6px;margin-top:0.25rem;max-height:220px;overflow:auto">' + esc(ev.input) + '</pre></div>';
    if (ev.output) body += '<div style="margin-top:0.5rem"><strong>Output</strong><pre style="white-space:pre-wrap;background:rgba(255,255,255,0.03);padding:0.6rem;border-radius:6px;margin-top:0.25rem;max-height:300px;overflow:auto">' + esc(ev.output) + '</pre></div>';
    if (ev.error) body += '<div style="margin-top:0.5rem"><strong>Error</strong><pre style="white-space:pre-wrap;background:rgba(248,113,113,0.06);color:#fca5a5;padding:0.6rem;border-radius:6px;margin-top:0.25rem;max-height:220px;overflow:auto">' + esc(ev.error) + '</pre></div>';
    if (ev.meta && Object.keys(ev.meta).length) body += '<div style="margin-top:0.5rem"><strong>Meta</strong><pre style="white-space:pre-wrap;background:rgba(255,255,255,0.03);padding:0.6rem;border-radius:6px;margin-top:0.25rem;max-height:200px;overflow:auto">' + esc(JSON.stringify(ev.meta, null, 2)) + '</pre></div>';
    document.getElementById('eventModalBody').innerHTML = body;
    document.getElementById('eventModalTitle').textContent = 'Event #' + ev.id;
    document.getElementById('eventDeleteBtn').onclick = function() { deleteEvent(ev.id, true); };
    document.getElementById('eventModal').classList.add('open');
}

export async function deleteEvent(id, fromModal) {
    if (!confirm('Delete this event log entry?')) return;
    var r = await api('DELETE', '/api/event-logs/' + id);
    if (r && r.error) return alert(r.error);
    if (fromModal) closeModal('eventModal');
    await loadEvents();
}

export async function clearEvents() {
    var kind = document.getElementById('eventsKindFilter').value;
    var label = kind ? ('all "' + kind + '" entries') : 'ALL event log entries';
    if (!confirm('Delete ' + label + '? This cannot be undone.')) return;
    var qs = kind ? ('?kind=' + encodeURIComponent(kind)) : '';
    var r = await api('DELETE', '/api/event-logs' + qs);
    if (r && r.error) return alert(r.error);
    await loadEvents();
}
