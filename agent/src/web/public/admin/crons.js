import { state, api, esc, find, closeModal, timezoneOptions, load, onRender } from './store.js';

// View state for the state.crons table: sub-tab (all/active/inactive) and
// free-text filter. Both are pure client-side over the loaded list.
var cronView = 'all';
// Default order reproduces the old fixed sort: enabled first, id ascending.
var cronSort = { key: 'enabled', dir: 'desc' };
export function setCronView(v) { cronView = v; renderCrons(); }

export function setCronSort(key) {
    // Same column flips direction; a new column opens on the direction
    // that is useful first — newest run and enabled-on at the top.
    if (cronSort.key === key) cronSort.dir = cronSort.dir === 'asc' ? 'desc' : 'asc';
    else cronSort = { key: key, dir: (key === 'last' || key === 'enabled') ? 'desc' : 'asc' };
    renderCrons();
}

export function cronMatchesFilter(j, q) {
    if (!q) return true;
    var hay = [j.agent_name, j.prompt, j.description, j.expression, j.channel_name, j.chat_id, j.session_id, j.timezone]
        .filter(Boolean).join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
}

// A job counts as failing once it has actually run and the last run
// did not report ok. Never-run jobs are not failures.
export function cronFailed(j) { return !!j.last_run_at && j.last_status !== 'ok'; }

export function cronTargetKey(j) {
    if (j.chat_id) return 'tg:' + (j.channel_name || '') + '/' + j.chat_id;
    if (j.session_id) return 'web:' + j.session_id;
    return '';
}

export function cronSortValue(j, key) {
    if (key === 'id') return j.id;
    if (key === 'agent') return (j.agent_name || '').toLowerCase();
    if (key === 'target') return cronTargetKey(j).toLowerCase();
    if (key === 'schedule') return j.expression || j.run_at || '';
    if (key === 'prompt') return (j.prompt || '').toLowerCase();
    if (key === 'last') return j.last_run_at ? Date.parse(j.last_run_at) : 0;
    if (key === 'enabled') return j.enabled ? 1 : 0;
    return 0;
}

// Rebuilt from the loaded jobs each render so the list tracks reality;
// the current pick survives unless its agent no longer has any job.
export function syncCronAgentOptions(sel) {
    var seen = {}, opts = [];
    state.crons.forEach(function(j) {
        if (j.agent_id == null || seen[j.agent_id]) return;
        seen[j.agent_id] = true;
        opts.push({ id: j.agent_id, name: j.agent_name || ('#' + j.agent_id) });
    });
    opts.sort(function(a, b) { return a.name.localeCompare(b.name); });
    var html = '<option value="">All agents</option>' + opts.map(function(o) {
        return '<option value="' + esc(String(o.id)) + '">' + esc(o.name) + '</option>';
    }).join('');
    if (sel.innerHTML === html) return;
    var cur = sel.value;
    sel.innerHTML = html;
    sel.value = cur;
}

export function renderCrons() {
    var q = (document.getElementById('cronFilterInput').value || '').trim().toLowerCase();
    var agentSel = document.getElementById('cronAgentFilter');
    syncCronAgentOptions(agentSel);
    var agentPick = agentSel.value;

    var activeCount = state.crons.filter(function(j){ return j.enabled; }).length;
    var counts = {
        all: state.crons.length,
        active: activeCount,
        inactive: state.crons.length - activeCount,
        failing: state.crons.filter(cronFailed).length,
    };
    document.querySelectorAll('#cronViewTabs button').forEach(function(b) {
        var v = b.dataset.cronView;
        b.textContent = v.charAt(0).toUpperCase() + v.slice(1) + ' (' + counts[v] + ')';
        b.className = 'btn btn-xs ' + (v === cronView ? 'btn-primary' : 'btn-ghost border border-white/10');
    });
    document.querySelectorAll('#tab-crons th.cron-sort').forEach(function(th) {
        var arrow = th.dataset.cronSort === cronSort.key ? (cronSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
        th.textContent = th.dataset.label + arrow;
    });

    var shown = state.crons.filter(function(j) {
        if (cronView === 'active' && !j.enabled) return false;
        if (cronView === 'inactive' && j.enabled) return false;
        if (cronView === 'failing' && !cronFailed(j)) return false;
        if (agentPick && String(j.agent_id) !== agentPick) return false;
        return cronMatchesFilter(j, q);
    });
    var dir = cronSort.dir === 'asc' ? 1 : -1;
    shown.sort(function(a, b) {
        var av = cronSortValue(a, cronSort.key), bv = cronSortValue(b, cronSort.key);
        if (av < bv) return -dir;
        if (av > bv) return dir;
        return a.id - b.id;
    });

    if (!shown.length) {
        document.getElementById('cronsTable').innerHTML =
            '<tr><td colspan="8" style="opacity:0.4;text-align:center;padding:1.5rem">No jobs match.</td></tr>';
        return;
    }
    document.getElementById('cronsTable').innerHTML = shown.map(function(j) {
        var sched = j.expression
            ? '<code>' + esc(j.expression) + '</code>'
            : 'at ' + esc(new Date(j.run_at).toISOString());
        var target;
        if (j.chat_id) target = 'TG: <strong>' + esc(j.channel_name||'?') + '</strong> / ' + esc(j.chat_id);
        else if (j.session_id) target = 'Web: <code>' + esc(String(j.session_id).slice(0,16)) + (j.session_id.length>16?'…':'') + '</code>';
        else target = '?';
        var last = j.last_run_at
            ? '<span class="badge badge-sm ' + (j.last_status==='ok'?'badge-on':'badge-off') + '">' + esc(j.last_status||'?') + '</span> <span style="opacity:0.5;font-size:0.7rem">' + esc(new Date(j.last_run_at).toISOString().replace('T',' ').slice(0,16)) + '</span>'
            : '<span style="opacity:0.4">never</span>';
        var tz = (j.timezone && j.timezone!=='UTC') ? ' <span style="opacity:0.5;font-size:0.7rem">' + esc(j.timezone) + '</span>' : '';
        var promptCell = '<div style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(j.prompt||'') + '</div>'
            + (j.description ? '<div class="cron-desc" style="font-size:0.7rem;opacity:0.5;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(j.description) + '</div>' : '');
        return '<tr><td>' + j.id + '</td>'
            + '<td>' + esc(j.agent_name||'?') + '</td>'
            + '<td>' + target + '</td>'
            + '<td>' + sched + tz + '</td>'
            + '<td>' + promptCell + '</td>'
            + '<td>' + last + '</td>'
            + '<td><span class="badge badge-sm ' + (j.enabled?'badge-on':'badge-off') + '">' + (j.enabled?'on':'off') + '</span></td>'
            + '<td class="actions"><button onclick="editCron(' + j.id + ')">Edit</button>'
            + '<button class="danger" onclick="deleteCron(' + j.id + ')">Delete</button></td></tr>';
    }).join('');
}


export function onCronTargetTypeChange() {
    var t = document.getElementById('cronTargetType').value;
    document.getElementById('cronTelegramFields').style.display = t==='telegram'?'block':'none';
    document.getElementById('cronWebFields').style.display = t==='web'?'block':'none';
}

export function onCronScheduleTypeChange() {
    var t = document.getElementById('cronScheduleType').value;
    document.getElementById('cronExpressionField').style.display = t==='recurring'?'block':'none';
    document.getElementById('cronRunAtField').style.display = t==='one_shot'?'block':'none';
}

export function openCronModal(j) {
    if (typeof j==='number') j = find(state.crons, j);
    var editing = !!j;
    document.getElementById('cronModalTitle').textContent = editing?'Edit Cron Job':'New Cron Job';
    document.getElementById('cronId').value = editing?j.id:'';
    document.getElementById('cronAgent').innerHTML = state.agents.map(function(a){return '<option value="'+a.id+'">'+esc(a.name)+'</option>';}).join('');
    document.getElementById('cronAgent').value = editing?j.agent_id:(state.agents[0]?state.agents[0].id:'');
    document.getElementById('cronChannel').innerHTML = state.channels.filter(function(c){return c.type==='telegram';}).map(function(c){return '<option value="'+c.id+'">'+esc(c.name)+'</option>';}).join('');
    document.getElementById('cronSession').innerHTML = state.sessions.map(function(s){return '<option value="'+esc(s.id)+'">'+esc(s.id)+' &mdash; '+esc(s.agentName||'?')+'</option>';}).join('');

    var targetType = (editing && j.session_id) ? 'web' : 'telegram';
    document.getElementById('cronTargetType').value = targetType;
    if (editing && j.channel_id) document.getElementById('cronChannel').value = j.channel_id;
    if (editing && j.session_id) document.getElementById('cronSession').value = j.session_id;
    document.getElementById('cronChatId').value = editing && j.chat_id ? j.chat_id : '';

    var schedType = (editing && j.run_at) ? 'one_shot' : 'recurring';
    document.getElementById('cronScheduleType').value = schedType;
    document.getElementById('cronExpression').value = editing ? (j.expression || '') : '';
    document.getElementById('cronRunAt').value = editing && j.run_at ? new Date(j.run_at).toISOString().slice(0,16) : '';

    document.getElementById('cronTimezone').innerHTML = timezoneOptions(editing ? (j.timezone || 'UTC') : (state.settings.timezone || 'UTC'));
    document.getElementById('cronDescription').value = editing ? (j.description || '') : '';
    document.getElementById('cronPrompt').value = editing ? (j.prompt || '') : '';
    document.getElementById('cronEnabled').checked = editing ? j.enabled !== false : true;

    document.getElementById('cronTargetType').disabled = editing;
    document.getElementById('cronChannel').disabled = editing;
    document.getElementById('cronChatId').disabled = editing;
    document.getElementById('cronSession').disabled = editing;
    document.getElementById('cronAgent').disabled = editing;
    document.getElementById('cronEditHint').style.display = editing ? 'block' : 'none';

    onCronTargetTypeChange();
    onCronScheduleTypeChange();
    document.getElementById('cronModal').classList.add('open');
}

export function editCron(id){ openCronModal(id); }

export async function saveCron() {
    var id = document.getElementById('cronId').value;
    var schedType = document.getElementById('cronScheduleType').value;
    var targetType = document.getElementById('cronTargetType').value;
    var body = {
        timezone: document.getElementById('cronTimezone').value || null,
        description: document.getElementById('cronDescription').value,
        prompt: document.getElementById('cronPrompt').value,
        enabled: document.getElementById('cronEnabled').checked,
    };
    if (schedType === 'recurring') {
        body.expression = document.getElementById('cronExpression').value;
        body.run_at = null;
    } else {
        var raw = document.getElementById('cronRunAt').value;
        body.run_at = raw ? new Date(raw).toISOString() : null;
        body.expression = null;
    }
    if (!id) {
        body.agent_id = parseInt(document.getElementById('cronAgent').value);
        if (targetType === 'telegram') {
            body.channel_id = parseInt(document.getElementById('cronChannel').value);
            body.chat_id = document.getElementById('cronChatId').value;
            body.session_id = null;
        } else {
            body.session_id = document.getElementById('cronSession').value;
            body.channel_id = null;
            body.chat_id = null;
        }
    }
    var r = id ? await api('PUT','/api/cron-jobs/'+id,body) : await api('POST','/api/cron-jobs',body);
    if (r && r.error) { alert(r.error); return; }
    closeModal('cronModal'); load();
}

export async function deleteCron(id) {
    if (!confirm('Delete this cron job?')) return;
    await api('DELETE','/api/cron-jobs/'+id); load();
}

onRender(renderCrons);
