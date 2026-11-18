import { useState } from 'react';
import { api } from '@/api';
import { maskKey } from '../data';
import { EmptyRow, Modal, OnOff, RowActions, TabHeader, Table, Toggle, editingKey, editingRow, text, write, type Editing, type TabProps } from '../ui';

export function Search({ data, reload }: TabProps) {
  const [editing, setEditing] = useState<Editing>(null);
  const engine = editingRow(editing);
  const [provider, setProvider] = useState('');
  const engines = data.searchEngines;

  function open(e: Editing) {
    // Options come from GET /api/search-engines' providers field — the
    // PROVIDERS map in lib/searchProviders.js is the single source of truth.
    setProvider(editingRow(e)?.provider ?? data.searchProviders[0]);
    setEditing(e);
  }

  async function save(form: FormData) {
    const body = {
      provider, api_key: text(form, 'searchEngineKey').trim(),
      cx: text(form, 'searchEngineCx').trim() || null, enabled: form.has('searchEngineEnabled'),
    };
    const request = engine ? api('PUT', '/api/search-engines/' + engine.id, body) : api('POST', '/api/search-engines', body);
    if (await write(request, reload, 'Search engine saved')) setEditing(null);
  }

  // Simple priority sorting: swap with the neighbor, send the full order.
  async function move(index: number, dir: number) {
    const ids = engines.map((e) => e.id);
    [ids[index], ids[index + dir]] = [ids[index + dir], ids[index]];
    await write(api('PUT', '/api/search-engines/order', { ids }), reload);
  }

  async function remove(id: number) {
    if (!confirm('Delete this search engine? If it is the last enabled one, the agent loses web search.')) return;
    await write(api('DELETE', '/api/search-engines/' + id), reload);
  }

  return (
    <>
      <TabHeader title="Search Engines" onNew={() => open('new')} newLabel="+ New Engine" />
      <Table bodyId="searchEnginesTable" head={<thead><tr><th>Priority</th><th>Provider</th><th>Key</th><th>Enabled</th><th></th></tr></thead>}>
        {engines.length === 0 && <EmptyRow colSpan={5}>No engines — the agent has no web search until one is added.</EmptyRow>}
        {engines.map((e, i) => (
          <tr key={e.id}>
            <td>
              <button disabled={i === 0} onClick={() => move(i, -1)}>↑</button>{' '}
              <button disabled={i === engines.length - 1} onClick={() => move(i, 1)}>↓</button>{' '}
              {i + 1}
            </td>
            <td><strong>{e.provider}</strong></td>
            <td><code>{maskKey(e.api_key)}</code></td>
            <td><OnOff isOn={e.enabled} /></td>
            <RowActions onEdit={() => open(e)} onDelete={() => remove(e.id)} />
          </tr>
        ))}
      </Table>
      <div className="hint">Providers for the agent's <code>web_search</code> tool, tried top to bottom — when one fails the next takes over. With no enabled engine the search tool disappears from the agent entirely (only <code>web_fetch</code> stays). Google needs an API key + Programmable Search Engine ID (cx); Brave needs just an API key.</div>

      <Modal id="searchEngineModal" title={engine ? 'Edit Search Engine' : 'New Search Engine'} isOpen={!!editing} formKey={editingKey(editing)}
        onClose={() => setEditing(null)} onSave={save}>
        <label>Provider</label>
        <select id="searchEngineProvider" value={provider} onChange={(e) => setProvider(e.target.value)}>
          {data.searchProviders.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <label>API key</label>
        <input type="text" id="searchEngineKey" name="searchEngineKey" placeholder="API key" defaultValue={engine?.api_key ?? ''} />
        <div id="searchEngineCxField" style={{ display: provider === 'google' ? 'block' : 'none' }}>
          <label>Search Engine ID (cx)</label>
          <input type="text" id="searchEngineCx" name="searchEngineCx" placeholder="Programmable Search Engine ID" defaultValue={engine?.cx ?? ''} />
        </div>
        <Toggle id="searchEngineEnabled" label="Enabled" defaultChecked={engine ? !!engine.enabled : true} />
      </Modal>
    </>
  );
}
