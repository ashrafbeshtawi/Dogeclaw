import { state, api, esc, find, closeModal, load, onRender } from './store.js';

// MCP server CRUD
export function onMcpTransportChange() {
    var http = document.getElementById('mcpTransport').value === 'http';
    document.getElementById('mcpStdioFields').style.display = http ? 'none' : 'block';
    document.getElementById('mcpHttpFields').style.display = http ? 'block' : 'none';
}

export function renderMcp() {
    document.getElementById('mcpTable').innerHTML = state.mcpServers.map(function(s) {
        var cmd = s.transport === 'http'
            ? s.url
            : s.command + (s.args && s.args.length ? ' ' + s.args.join(' ') : '');
        var assigned = (s.agent_ids || []).map(function(id) {
            var a = find(state.agents, id);
            return a ? '<span class="badge badge-sm badge-tag">' + esc(a.name) + '</span>' : '';
        }).join(' ');
        var agentsCell = assigned || '<span class="badge badge-sm badge-off">hidden</span>';
        return '<tr><td><strong>'+esc(s.name)+'</strong></td>'
            +'<td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><code>'+esc(cmd)+'</code></td>'
            +'<td>'+agentsCell+'</td>'
            +'<td><span class="badge badge-sm '+(s.enabled?'badge-on':'badge-off')+'">'+(s.enabled?'on':'off')+'</span></td>'
            +'<td class="actions"><button onclick="editMcp('+s.id+')">Edit</button>'
            +'<button class="danger" onclick="deleteMcp('+s.id+')">Delete</button></td></tr>';
    }).join('');
}

export function openMcpModal(s) {
    if (typeof s === 'number') s = find(state.mcpServers, s);
    document.getElementById('mcpModalTitle').textContent = s ? 'Edit MCP Server' : 'New MCP Server';
    document.getElementById('mcpId').value = s ? s.id : '';
    document.getElementById('mcpName').value = s ? s.name : '';
    document.getElementById('mcpTransport').value = s ? (s.transport || 'stdio') : 'stdio';
    document.getElementById('mcpCommand').value = s ? (s.command || '') : '';
    document.getElementById('mcpArgs').value = s ? (s.args || []).join('\n') : '';
    document.getElementById('mcpEnv').value = s ? Object.entries(s.env || {}).map(function(e){ return e[0]+'='+e[1]; }).join('\n') : '';
    document.getElementById('mcpUrl').value = s ? (s.url || '') : '';
    document.getElementById('mcpHeaders').value = s ? Object.entries(s.headers || {}).map(function(e){ return e[0]+'='+e[1]; }).join('\n') : '';
    document.getElementById('mcpDescription').value = s ? (s.description || '') : '';
    document.getElementById('mcpEnabled').checked = s ? s.enabled : true;
    onMcpTransportChange();
    document.getElementById('mcpDiscoverStatus').textContent = '';
    document.getElementById('mcpToolList').style.display = 'none';
    var assigned = s ? (s.agent_ids || []) : [];
    document.getElementById('mcpAgentsCheckboxes').innerHTML = state.agents.map(function(a) {
        var checked = assigned.includes(a.id) ? 'checked' : '';
        return '<label style="display:block;font-size:0.8rem;margin-bottom:0.2rem"><input type="checkbox" value="' + a.id + '" ' + checked + ' style="margin-right:0.4rem;accent-color:#dc2626"> ' + esc(a.name) + '</label>';
    }).join('');
    document.getElementById('mcpModal').classList.add('open');
}
export function editMcp(id){ openMcpModal(id); }

export function parseKeyValueLines(text) {
    var out = {};
    text.split('\n').forEach(function(l) {
        var i = l.indexOf('=');
        if (i > 0) out[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    });
    return out;
}

export function mcpFormDef() {
    var args = document.getElementById('mcpArgs').value.split('\n').map(function(l){ return l.trim(); }).filter(Boolean);
    return {
        transport: document.getElementById('mcpTransport').value,
        command: document.getElementById('mcpCommand').value.trim(),
        args: args,
        env: parseKeyValueLines(document.getElementById('mcpEnv').value),
        url: document.getElementById('mcpUrl').value.trim(),
        headers: parseKeyValueLines(document.getElementById('mcpHeaders').value),
    };
}

// Preview only: all discovered tools get exposed — there is no
// selection, since MCP tool sets change without notice.
export async function discoverMcp() {
    var st = document.getElementById('mcpDiscoverStatus');
    st.textContent = 'Connecting…';
    try {
        var r = await api('POST', '/api/mcp/discover', mcpFormDef());
        if (r.error) { st.textContent = 'Failed: ' + r.error; return; }
        var tools = r.tools || [];
        st.textContent = 'Server offers ' + tools.length + ' tool(s) — all exposed to assigned agents. Live tool registry refreshed.';
        var el = document.getElementById('mcpToolList');
        el.style.display = tools.length ? 'block' : 'none';
        el.innerHTML = tools.map(function(t) {
            return '<div style="font-size:0.8rem;margin-bottom:0.2rem"><code>'+esc(t.name)+'</code>'
                +(t.description ? ' <span class="field-hint">'+esc(t.description.slice(0,80))+'</span>' : '')
                +'</div>';
        }).join('');
    } catch (err) {
        st.textContent = 'Error: ' + err.message;
    }
}

export async function saveMcp() {
    var id = document.getElementById('mcpId').value;
    var body = mcpFormDef();
    body.name = document.getElementById('mcpName').value.trim();
    body.description = document.getElementById('mcpDescription').value.trim();
    body.enabled = document.getElementById('mcpEnabled').checked;
    body.agent_ids = Array.from(document.getElementById('mcpAgentsCheckboxes').querySelectorAll('input:checked')).map(function(i){ return parseInt(i.value); });
    var r = id ? await api('PUT', '/api/mcp/'+id, body) : await api('POST', '/api/mcp', body);
    if (r.error) { alert(r.error); return; }
    closeModal('mcpModal');
    load();
}


export async function deleteMcp(id) {
    if (!confirm('Delete this MCP server? Its tools disappear from the agent immediately.')) return;
    await api('DELETE', '/api/mcp/'+id);
    load();
}

onRender(renderMcp);
