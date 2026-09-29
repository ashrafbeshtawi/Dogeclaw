import { state, api, esc, find, closeModal, load, onRender } from './store.js';

export function renderChannels() {
    document.getElementById('channelsTable').innerHTML = state.channels.map(function(c) {
        return '<tr><td><strong>'+esc(c.name)+'</strong></td><td>'+esc(c.type)+'</td><td>'+esc(c.agent_name)+'</td>'
            +'<td>'+esc(c.response_mode)+(c.response_interval?' / '+esc(c.response_interval):'')+'</td>'
            +'<td><span class="badge badge-sm '+(c.enabled?'badge-on':'badge-off')+'">'+(c.enabled?'on':'off')+'</span></td>'
            +'<td class="actions"><button onclick="editChannel('+c.id+')">Edit</button>'
            +'<button class="danger" onclick="deleteChannel('+c.id+')">Delete</button></td></tr>';
    }).join('');
}


// Channel CRUD
export function updateWebhookHint(channel) {
    var h = document.getElementById('webhookHint');
    if (state.siteConfig.telegramMode === 'polling') { h.textContent = 'Using polling mode (dev).'; return; }
    if (state.siteConfig.telegramMode !== 'webhook' || !state.siteConfig.webhookUrl) { h.textContent = ''; return; }
    h.innerHTML = channel && channel.webhook_id
        ? 'Webhook: <code>' + esc(state.siteConfig.webhookUrl) + '/webhook/' + esc(channel.webhook_id) + '</code>'
        : 'Webhook path is minted when the channel is created.';
}
export function openChannelModal(c) {
    if (typeof c==='number') c=find(state.channels,c);
    document.getElementById('channelModalTitle').textContent = c?'Edit Channel':'New Channel';
    document.getElementById('channelId').value = c?c.id:'';
    document.getElementById('channelName').value = c?c.name:'';
    document.getElementById('channelType').value = c?c.type:'telegram';
    document.getElementById('channelToken').value = c?c.token||'':'';
    document.getElementById('channelUsers').value = c&&c.allowed_users?c.allowed_users.join(','):'';
    document.getElementById('channelMode').value = c?c.response_mode:'immediate';
    document.getElementById('channelInterval').value = c?c.response_interval||'':'';
    document.getElementById('channelEnabled').checked = c?c.enabled!==false:true;
    setTimeout(function(){if(c&&c.agent_id)document.getElementById('channelAgent').value=c.agent_id;},0);
    document.getElementById('channelModal').classList.add('open');
    updateWebhookHint(c);
}
export function editChannel(id){openChannelModal(id);}
export async function saveChannel() {
    var id = document.getElementById('channelId').value;
    var body = {name:document.getElementById('channelName').value, type:document.getElementById('channelType').value,
        agent_id:parseInt(document.getElementById('channelAgent').value),
        token:document.getElementById('channelToken').value,
        allowed_users:document.getElementById('channelUsers').value.split(',').map(Number).filter(Boolean),
        response_mode:document.getElementById('channelMode').value, response_interval:document.getElementById('channelInterval').value||null,
        enabled:document.getElementById('channelEnabled').checked};
    if (id) await api('PUT','/api/channels/'+id,body); else await api('POST','/api/channels',body);
    closeModal('channelModal'); load();
}
export async function deleteChannel(id){if(!confirm('Delete this channel?'))return;await api('DELETE','/api/channels/'+id);load();}

// Cron CRUD

onRender(renderChannels);
