import { state, api, esc, find, closeModal, load, onRender } from './store.js';

// Agent CRUD
export function renderSkills() {
    document.getElementById('skillsTable').innerHTML = state.skills.map(function(s) {
        var ids = s.agent_ids || [];
        var access = ids.length === 0 ? '<span class="badge badge-sm badge-on">public</span>'
            : ids.map(function(id) { var a = find(state.agents, id); return '<span class="badge badge-sm badge-tag">' + esc(a ? a.name : '?') + '</span>'; }).join(' ');
        return '<tr><td><strong>' + esc(s.name) + '</strong></td>'
            + '<td>' + esc(s.description) + '</td>'
            + '<td>' + access + '</td>'
            + '<td class="actions"><button onclick="editSkill(' + s.id + ')">Edit</button>'
            + '<button class="danger" onclick="deleteSkill(' + s.id + ')">Delete</button></td></tr>';
    }).join('');
}

export function openSkillModal(s) {
    if (typeof s==='number') s=find(state.skills,s);
    document.getElementById('skillModalTitle').textContent = s?'Edit Skill':'New Skill';
    document.getElementById('skillFormId').value = s?s.id:'';
    document.getElementById('skillName').value = s?s.name:'';
    document.getElementById('skillDescription').value = s?s.description:'';
    document.getElementById('skillContent').value = s?s.content:'';
    var assigned = s ? (s.agent_ids || []) : [];
    document.getElementById('skillAgentsCheckboxes').innerHTML = state.agents.map(function(a) {
        var checked = assigned.includes(a.id) ? 'checked' : '';
        return '<label style="display:block;font-size:0.8rem;margin-bottom:0.2rem"><input type="checkbox" value="' + a.id + '" ' + checked + ' style="margin-right:0.4rem;accent-color:#dc2626"> ' + esc(a.name) + '</label>';
    }).join('');
    document.getElementById('skillModal').classList.add('open');
}
export function editSkill(id){openSkillModal(id);}

export async function saveSkill() {
    var id = document.getElementById('skillFormId').value;
    var checked = Array.from(document.getElementById('skillAgentsCheckboxes').querySelectorAll('input:checked')).map(function(i){return parseInt(i.value);});
    var body = {
        name: document.getElementById('skillName').value,
        description: document.getElementById('skillDescription').value,
        content: document.getElementById('skillContent').value,
        agent_ids: checked,
    };
    if (id) await api('PUT','/api/skills/'+id,body);
    else await api('POST','/api/skills',body);
    closeModal('skillModal'); load();
}

export async function deleteSkill(id) {
    if (!confirm('Delete this skill?')) return;
    await api('DELETE','/api/skills/'+id); load();
}

onRender(renderSkills);
