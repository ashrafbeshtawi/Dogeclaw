import { useState } from 'react';
import { api } from '@/api';
import { findById } from '../data';
import { CheckList, Modal, RowActions, TabHeader, Table, checkedIds, editingKey, editingRow, text, write, type Editing, type TabProps } from '../ui';

export function Skills({ data, reload }: TabProps) {
  const [editing, setEditing] = useState<Editing>(null);
  const skill = editingRow(editing);

  async function save(form: FormData) {
    const body = {
      name: text(form, 'skillName'), description: text(form, 'skillDescription'),
      content: text(form, 'skillContent'), agent_ids: checkedIds(form, 'skillAgentsCheckboxes'),
    };
    const request = skill ? api('PUT', '/api/skills/' + skill.id, body) : api('POST', '/api/skills', body);
    if (await write(request, reload, 'Skill saved')) setEditing(null);
  }

  async function remove(id: number) {
    if (!confirm('Delete this skill?')) return;
    await write(api('DELETE', '/api/skills/' + id), reload);
  }

  return (
    <>
      <TabHeader title="Skills" onNew={() => setEditing('new')} newLabel="+ New Skill" />
      <Table bodyId="skillsTable" head={<thead><tr><th>Name</th><th>Description</th><th>Access</th><th></th></tr></thead>}>
        {data.skills.map((s) => {
          const ids: number[] = s.agent_ids || [];
          return (
            <tr key={s.id}>
              <td><strong>{s.name}</strong></td>
              <td>{s.description}</td>
              <td>
                {ids.length === 0
                  ? <span className="badge badge-on">public</span>
                  : ids.map((id) => <span key={id} className="badge badge-tag">{findById(data.agents, id)?.name ?? '?'}</span>)}
              </td>
              <RowActions onEdit={() => setEditing(s)} onDelete={() => remove(s.id)} />
            </tr>
          );
        })}
      </Table>
      <div className="hint">Skills with no assigned agents are public (available to all). Assign agents to restrict access.</div>

      <Modal id="skillModal" title={skill ? 'Edit Skill' : 'New Skill'} isOpen={!!editing} formKey={editingKey(editing)}
        onClose={() => setEditing(null)} onSave={save}>
        <label>Name</label>
        <input type="text" id="skillName" name="skillName" placeholder="python_dev" defaultValue={skill?.name ?? ''} />
        <label>Description</label>
        <input type="text" id="skillDescription" name="skillDescription" placeholder="Best practices for Python development" defaultValue={skill?.description ?? ''} />
        <label>Content</label>
        <textarea id="skillContent" name="skillContent" placeholder="Detailed instructions, code patterns, references..." className="min-h-40" defaultValue={skill?.content ?? ''} />
        <label>Assigned Agents (empty = available to all)</label>
        <CheckList id="skillAgentsCheckboxes" checked={skill?.agent_ids || []} items={data.agents.map((a) => ({ id: a.id, label: a.name }))} />
      </Modal>
    </>
  );
}
