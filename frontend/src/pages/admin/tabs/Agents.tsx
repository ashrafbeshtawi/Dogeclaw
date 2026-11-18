import { useState } from 'react';
import { api } from '@/api';
import { CheckList, Modal, RowActions, TabHeader, Table, checkedIds, editingKey, editingRow, text, write, type Editing, type TabProps } from '../ui';

export function Agents({ data, reload }: TabProps) {
  const [editing, setEditing] = useState<Editing>(null);
  const agent = editingRow(editing);

  async function save(form: FormData) {
    const modelId = text(form, 'agentModel');
    const body = { name: text(form, 'agentName'), system_prompt: text(form, 'agentPrompt'), model_id: modelId ? parseInt(modelId) : null };
    const request = (async () => {
      const saved = agent ? await api('PUT', '/api/agents/' + agent.id, body) : await api('POST', '/api/agents', body);
      if (saved?.error) return saved;
      return api('PUT', '/api/agents/' + (saved?.id || agent?.id) + '/skills', { skill_ids: checkedIds(form, 'agentSkillsCheckboxes') });
    })();
    if (await write(request, reload, 'Agent saved')) setEditing(null);
  }

  async function remove(id: number) {
    if (!confirm('Delete this agent?')) return;
    await write(api('DELETE', '/api/agents/' + id), reload);
  }

  return (
    <>
      <TabHeader title="Agents" onNew={() => setEditing('new')} newLabel="+ New Agent" />
      <Table bodyId="agentsTable" head={<thead><tr><th>Name</th><th>Model</th><th>System Prompt</th><th></th></tr></thead>}>
        {data.agents.map((a) => (
          <tr key={a.id}>
            <td><strong>{a.name}</strong></td>
            <td>{a.model_name || <span className="opacity-40">none</span>}</td>
            <td className="max-w-[300px] truncate">{a.system_prompt}</td>
            <RowActions onEdit={() => setEditing(a)} onDelete={() => remove(a.id)} />
          </tr>
        ))}
      </Table>

      <Modal id="agentModal" title={agent ? 'Edit Agent' : 'New Agent'} isOpen={!!editing} formKey={editingKey(editing)}
        onClose={() => setEditing(null)} onSave={save}>
        <label>Name</label>
        <input type="text" id="agentName" name="agentName" placeholder="my-agent" defaultValue={agent?.name ?? ''} />
        <label>Model</label>
        <select id="agentModel" name="agentModel" defaultValue={agent?.model_id ?? ''}>
          <option value="">(default)</option>
          {data.models.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.model_id})</option>)}
        </select>
        <label>System Prompt</label>
        <textarea id="agentPrompt" name="agentPrompt" placeholder="You are a helpful assistant..." defaultValue={agent?.system_prompt ?? ''} />
        <label>Skills</label>
        <CheckList id="agentSkillsCheckboxes" checked={agent?.skill_ids || []} empty="No skills yet. Create skills first."
          items={data.skills.map((s) => ({ id: s.id, label: <>{s.name} <span className="opacity-50">- {s.description}</span></> }))} />
        <div className="field-hint">Select skills to assign. Unselected public skills are still available.</div>
      </Modal>
    </>
  );
}
