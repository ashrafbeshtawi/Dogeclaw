import { state, api, esc, find, closeModal, load, onRender } from './store.js';

export function renderAgents() {
    document.getElementById('agentsTable').innerHTML = state.agents.map(function(a) {
        return '<tr><td><strong>'+esc(a.name)+'</strong></td><td>'+(esc(a.model_name)||'<span style="opacity:0.4">none</span>')+'</td>'
            +'<td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(a.system_prompt)+'</td>'
            +'<td class="actions"><button onclick="editAgent('+a.id+')">Edit</button>'
            +'<button class="danger" onclick="deleteAgent('+a.id+')">Delete</button></td></tr>';
    }).join('');
    document.getElementById('channelAgent').innerHTML = state.agents.map(function(a){return '<option value="'+a.id+'">'+esc(a.name)+'</option>';}).join('');
}


export function openAgentModal(a) {
    if (typeof a==='number') a=find(state.agents,a);
    document.getElementById('agentModalTitle').textContent = a?'Edit Agent':'New Agent';
    document.getElementById('agentId').value = a?a.id:'';
    document.getElementById('agentName').value = a?a.name:'';
    document.getElementById('agentPrompt').value = a?a.system_prompt:'';
    document.getElementById('agentModel').innerHTML = '<option value="">(default)</option>'+state.models.map(function(m){return '<option value="'+m.id+'">'+esc(m.name)+' ('+esc(m.model_id)+')</option>';}).join('');
    document.getElementById('agentModel').value = a&&a.model_id?a.model_id:'';
    var assignedSkills = a ? (a.skill_ids || []) : [];
    document.getElementById('agentSkillsCheckboxes').innerHTML = state.skills.length === 0
        ? '<span style="opacity:0.5;font-size:0.8rem">No skills yet. Create skills first.</span>'
        : state.skills.map(function(s) {
            var checked = assignedSkills.includes(s.id) ? 'checked' : '';
            return '<label style="display:block;font-size:0.8rem;margin-bottom:0.2rem"><input type="checkbox" value="' + s.id + '" ' + checked + ' style="margin-right:0.4rem;accent-color:#dc2626"> ' + esc(s.name) + ' <span style="opacity:0.5">- ' + esc(s.description) + '</span></label>';
        }).join('');
    document.getElementById('agentModal').classList.add('open');
}
export function editAgent(id){openAgentModal(id);}
export async function saveAgent() {
    var id = document.getElementById('agentId').value;
    var mid = document.getElementById('agentModel').value;
    var body = {name:document.getElementById('agentName').value, system_prompt:document.getElementById('agentPrompt').value, model_id:mid?parseInt(mid):null};
    var saved;
    if (id) saved = await api('PUT','/api/agents/'+id,body);
    else saved = await api('POST','/api/agents',body);
    // Save skill assignments
    var checkedSkills = Array.from(document.getElementById('agentSkillsCheckboxes').querySelectorAll('input:checked')).map(function(i){return parseInt(i.value);});
    var agentId = saved?.id || id;
    if (agentId) {
        await api('PUT', '/api/agents/' + agentId + '/skills', { skill_ids: checkedSkills });
    }
    closeModal('agentModal'); load();
}
export async function deleteAgent(id){if(!confirm('Delete this agent?'))return;await api('DELETE','/api/agents/'+id);load();}

onRender(renderAgents);
