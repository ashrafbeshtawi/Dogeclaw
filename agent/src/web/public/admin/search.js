import { state, api, esc, find, closeModal, load, onRender } from './store.js';

// Search engine CRUD + priority sorting
export function renderSearchEngines() {
    document.getElementById('searchEnginesTable').innerHTML = state.searchEngines.map(function(e, i) {
        var key = e.api_key.length > 8 ? e.api_key.slice(0, 4) + '…' + e.api_key.slice(-4) : e.api_key;
        return '<tr><td>'
            +'<button '+(i === 0 ? 'disabled' : '')+' onclick="moveSearchEngine('+e.id+',-1)">↑</button> '
            +'<button '+(i === state.searchEngines.length - 1 ? 'disabled' : '')+' onclick="moveSearchEngine('+e.id+',1)">↓</button> '
            +(i + 1)+'</td>'
            +'<td><strong>'+esc(e.provider)+'</strong></td>'
            +'<td><code>'+esc(key)+'</code></td>'
            +'<td><span class="badge badge-sm '+(e.enabled?'badge-on':'badge-off')+'">'+(e.enabled?'on':'off')+'</span></td>'
            +'<td class="actions"><button onclick="editSearchEngine('+e.id+')">Edit</button>'
            +'<button class="danger" onclick="deleteSearchEngine('+e.id+')">Delete</button></td></tr>';
    }).join('') || '<tr><td colspan="5" style="opacity:0.4;text-align:center;padding:1.5rem">No engines — the agent has no web search until one is added.</td></tr>';
}

export function onSearchProviderChange() {
    var google = document.getElementById('searchEngineProvider').value === 'google';
    document.getElementById('searchEngineCxField').style.display = google ? 'block' : 'none';
}

export function openSearchEngineModal(e) {
    if (typeof e === 'number') e = find(state.searchEngines, e);
    document.getElementById('searchEngineModalTitle').textContent = e ? 'Edit Search Engine' : 'New Search Engine';
    document.getElementById('searchEngineId').value = e ? e.id : '';
    document.getElementById('searchEngineProvider').innerHTML = state.searchProviders.map(function(p) {
        return '<option value="'+esc(p)+'">'+esc(p)+'</option>';
    }).join('');
    document.getElementById('searchEngineProvider').value = e ? e.provider : state.searchProviders[0];
    document.getElementById('searchEngineKey').value = e ? e.api_key : '';
    document.getElementById('searchEngineCx').value = e ? (e.cx || '') : '';
    document.getElementById('searchEngineEnabled').checked = e ? e.enabled : true;
    onSearchProviderChange();
    document.getElementById('searchEngineModal').classList.add('open');
}
export function editSearchEngine(id){ openSearchEngineModal(id); }

export async function saveSearchEngine() {
    var id = document.getElementById('searchEngineId').value;
    var body = {
        provider: document.getElementById('searchEngineProvider').value,
        api_key: document.getElementById('searchEngineKey').value.trim(),
        cx: document.getElementById('searchEngineCx').value.trim() || null,
        enabled: document.getElementById('searchEngineEnabled').checked,
    };
    var r = id ? await api('PUT', '/api/search-engines/'+id, body) : await api('POST', '/api/search-engines', body);
    if (r.error) { alert(r.error); return; }
    closeModal('searchEngineModal');
    load();
}

// Simple priority sorting: swap with the neighbor, send the full order.
export async function moveSearchEngine(id, dir) {
    var ids = state.searchEngines.map(function(e){ return e.id; });
    var i = ids.indexOf(id);
    var j = i + dir;
    if (j < 0 || j >= ids.length) return;
    ids[i] = ids[j]; ids[j] = id;
    await api('PUT', '/api/search-engines/order', { ids: ids });
    load();
}

export async function deleteSearchEngine(id) {
    if (!confirm('Delete this search engine? If it is the last enabled one, the agent loses web search.')) return;
    await api('DELETE', '/api/search-engines/'+id);
    load();
}

onRender(renderSearchEngines);
