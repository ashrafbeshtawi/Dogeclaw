import { state, api, esc, find, closeModal, load, onRender } from './store.js';

export function renderModels() {
    document.getElementById('modelsTable').innerHTML = state.models.map(function(m) {
        var acc = (m.accepts||['text']).map(function(a){return '<span class="badge badge-sm badge-tag">'+esc(a)+'</span>';}).join('');
        return '<tr><td><strong>'+esc(m.name)+'</strong></td><td>'+esc(m.provider)+'</td><td><code>'+esc(m.model_id)+'</code></td>'
            +'<td><span class="badge badge-sm '+(m.think?'badge-on':'badge-off')+'">'+(m.think?'on':'off')+'</span></td>'
            +'<td>'+acc+'</td><td class="actions"><button onclick="editModel('+m.id+')">Edit</button>'
            +'<button class="danger" onclick="deleteModel('+m.id+')">Delete</button></td></tr>';
    }).join('');
}


// Model CRUD
export function onProviderChange() {
    var p = document.getElementById('modelProvider').value;
    var urlInput = document.getElementById('modelBaseUrl');
    var keyRow = document.getElementById('apiKeyRow');
    var modelInput = document.getElementById('modelModelId');
    if (p === 'openrouter') {
        urlInput.value = 'https://openrouter.ai';
        urlInput.placeholder = 'https://openrouter.ai';
        keyRow.style.display = 'block';
        modelInput.placeholder = 'anthropic/claude-sonnet-4';
    } else if (p === 'google') {
        urlInput.value = 'https://generativelanguage.googleapis.com';
        urlInput.placeholder = 'https://generativelanguage.googleapis.com';
        keyRow.style.display = 'block';
        modelInput.placeholder = 'gemini-2.5-flash';
    } else {
        urlInput.value = 'http://ollama:11434';
        urlInput.placeholder = 'http://ollama:11434';
        keyRow.style.display = 'none';
        modelInput.placeholder = 'gemma4:e2b';
    }
}

export function openModelModal(m) {
    if (typeof m==='number') m=find(state.models,m);
    document.getElementById('modelModalTitle').textContent = m?'Edit Model':'New Model';
    document.getElementById('modelFormId').value = m?m.id:'';
    document.getElementById('modelName').value = m?m.name:'';
    document.getElementById('modelProvider').value = m?m.provider:'ollama';
    document.getElementById('modelBaseUrl').value = m?m.base_url:'http://ollama:11434';
    document.getElementById('modelModelId').value = m?m.model_id:'';
    document.getElementById('modelApiKey').value = m?m.api_key||'':'';
    document.getElementById('modelThink').checked = m?m.think:false;
    var acc = m?(m.accepts||['text']):['text'];
    document.getElementById('acceptImage').checked = acc.includes('image');
    document.getElementById('acceptAudio').checked = acc.includes('audio');
    document.getElementById('acceptVideo').checked = acc.includes('video');
    document.getElementById('testResult').style.display = 'none';
    onProviderChange();
    document.getElementById('modelModal').classList.add('open');
}
export function editModel(id){openModelModal(id);}

export async function testModel() {
    var el = document.getElementById('testResult');
    el.style.display = 'block';
    el.style.background = 'rgba(96,165,250,0.08)';
    el.style.color = '#60a5fa';
    el.textContent = 'Testing connection...';
    try {
        var body = {
            provider: document.getElementById('modelProvider').value,
            base_url: document.getElementById('modelBaseUrl').value,
            model_id: document.getElementById('modelModelId').value,
            api_key: document.getElementById('modelApiKey').value || null,
        };
        var r = await api('POST', '/api/models/test', body);
        if (r.ok) {
            el.style.background = 'rgba(52,211,153,0.08)';
            el.style.color = '#34d399';
            el.textContent = 'Connected! Reply: "' + (r.reply || '').slice(0, 100) + '"';
        } else {
            el.style.background = 'rgba(248,113,113,0.08)';
            el.style.color = '#f87171';
            el.textContent = 'Failed: ' + (r.error || 'unknown error');
        }
    } catch (err) {
        el.style.background = 'rgba(248,113,113,0.08)';
        el.style.color = '#f87171';
        el.textContent = 'Error: ' + err.message;
    }
}
export async function saveModel() {
    var id = document.getElementById('modelFormId').value;
    var acc = ['text'];
    if (document.getElementById('acceptImage').checked) acc.push('image');
    if (document.getElementById('acceptAudio').checked) acc.push('audio');
    if (document.getElementById('acceptVideo').checked) acc.push('video');
    var apiKey = document.getElementById('modelApiKey').value || null;
    var body = {name:document.getElementById('modelName').value, provider:document.getElementById('modelProvider').value,
        base_url:document.getElementById('modelBaseUrl').value, model_id:document.getElementById('modelModelId').value,
        api_key:apiKey, think:document.getElementById('modelThink').checked, accepts:acc};
    if (id) await api('PUT','/api/models/'+id,body); else await api('POST','/api/models',body);
    closeModal('modelModal'); load();
}
export async function deleteModel(id){if(!confirm('Delete this model?'))return;await api('DELETE','/api/models/'+id);load();}

onRender(renderModels);
