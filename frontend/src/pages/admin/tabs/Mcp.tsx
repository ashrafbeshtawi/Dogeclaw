import { useState } from 'react';
import { api } from '@/api';
import { findById, keyValueLines, parseKeyValueLines } from '../data';
import { CheckList, Modal, OnOff, RowActions, TabHeader, Table, Toggle, checkedIds, editingKey, editingRow, text, write, type Editing, type TabProps } from '../ui';

type Discovery = { status: string; tools: { name: string; description?: string }[] };

function serverDef(form: FormData, transport: string) {
  return {
    transport,
    command: text(form, 'mcpCommand').trim(),
    args: text(form, 'mcpArgs').split('\n').map((l) => l.trim()).filter(Boolean),
    env: parseKeyValueLines(text(form, 'mcpEnv')),
    url: text(form, 'mcpUrl').trim(),
    headers: parseKeyValueLines(text(form, 'mcpHeaders')),
  };
}

export function Mcp({ data, reload }: TabProps) {
  const [editing, setEditing] = useState<Editing>(null);
  const server = editingRow(editing);
  const [transport, setTransport] = useState('stdio');
  const [discovery, setDiscovery] = useState<Discovery | null>(null);

  function open(s: Editing) {
    setTransport(editingRow(s)?.transport || 'stdio');
    setDiscovery(null);
    setEditing(s);
  }

  // Preview only: all discovered tools get exposed — there is no selection,
  // since MCP tool sets change without notice.
  async function discover(form: HTMLFormElement) {
    setDiscovery({ status: 'Connecting…', tools: [] });
    try {
      const r = await api('POST', '/api/mcp/discover', serverDef(new FormData(form), transport));
      if (r.error) return setDiscovery({ status: 'Failed: ' + r.error, tools: [] });
      const tools = r.tools || [];
      setDiscovery({ status: 'Server offers ' + tools.length + ' tool(s) — all exposed to assigned agents. Live tool registry refreshed.', tools });
    } catch (err: any) {
      setDiscovery({ status: 'Error: ' + err.message, tools: [] });
    }
  }

  async function save(form: FormData) {
    const body = {
      ...serverDef(form, transport),
      name: text(form, 'mcpName').trim(),
      description: text(form, 'mcpDescription').trim(),
      enabled: form.has('mcpEnabled'),
      agent_ids: checkedIds(form, 'mcpAgentsCheckboxes'),
    };
    const request = server ? api('PUT', '/api/mcp/' + server.id, body) : api('POST', '/api/mcp', body);
    if (await write(request, reload, 'MCP server saved')) setEditing(null);
  }

  async function remove(id: number) {
    if (!confirm('Delete this MCP server? Its tools disappear from the agent immediately.')) return;
    await write(api('DELETE', '/api/mcp/' + id), reload);
  }

  const isHttp = transport === 'http';

  return (
    <>
      <TabHeader title="MCP Servers" onNew={() => open('new')} newLabel="+ New Server" />
      <Table bodyId="mcpTable" head={<thead><tr><th>Name</th><th>Command</th><th>Agents</th><th>Enabled</th><th></th></tr></thead>}>
        {data.mcpServers.map((s) => {
          const cmd = s.transport === 'http' ? s.url : s.command + (s.args?.length ? ' ' + s.args.join(' ') : '');
          const assigned = (s.agent_ids || []).map((id: number) => findById(data.agents, id)).filter(Boolean);
          return (
            <tr key={s.id}>
              <td><strong>{s.name}</strong></td>
              <td className="max-w-[280px] truncate"><code>{cmd}</code></td>
              <td>
                {assigned.length
                  ? assigned.map((a: any) => <span key={a.id} className="badge badge-tag">{a.name}</span>)
                  : <span className="badge badge-off">hidden</span>}
              </td>
              <td><OnOff isOn={s.enabled} /></td>
              <RowActions onEdit={() => open(s)} onDelete={() => remove(s.id)} />
            </tr>
          );
        })}
      </Table>
      <div className="hint">Tools are exposed as <code>mcp_&lt;server&gt;_&lt;tool&gt;</code> — all of them, since MCP servers can change their tool set without notice. Only agents assigned to a server see its tools; a server with no agents is hidden from everyone. Changes reconnect immediately, no restart needed.</div>

      <Modal id="mcpModal" title={server ? 'Edit MCP Server' : 'New MCP Server'} isOpen={!!editing} formKey={editingKey(editing)}
        onClose={() => setEditing(null)} onSave={save}>
        <label>Name</label>
        <input type="text" id="mcpName" name="mcpName" placeholder="google-calendar" defaultValue={server?.name ?? ''} />
        <div className="field-hint">Letters, digits, <code>-</code>, <code>_</code> only — becomes the tool prefix <code>mcp_&lt;name&gt;_*</code>.</div>
        <label>Description</label>
        <input type="text" id="mcpDescription" name="mcpDescription" placeholder="Company calendar: events, invites, availability" defaultValue={server?.description ?? ''} />
        <div className="field-hint">Shown to the agent in its system prompt — one line on what this server is for.</div>
        <label>Transport</label>
        <select id="mcpTransport" value={transport} onChange={(e) => setTransport(e.target.value)}>
          <option value="stdio">stdio (local process)</option>
          <option value="http">http (remote server)</option>
        </select>
        <div id="mcpStdioFields" style={{ display: isHttp ? 'none' : 'block' }}>
          <label>Command</label>
          <input type="text" id="mcpCommand" name="mcpCommand" placeholder="npx" defaultValue={server?.command ?? ''} />
          <label>Arguments (one per line)</label>
          <textarea id="mcpArgs" name="mcpArgs" placeholder={'-y\n@some/mcp-server'} className="min-h-20" defaultValue={(server?.args || []).join('\n')} />
          <label>Environment (KEY=VALUE, one per line)</label>
          <textarea id="mcpEnv" name="mcpEnv" placeholder="API_KEY=..." className="min-h-20" defaultValue={keyValueLines(server?.env)} />
        </div>
        <div id="mcpHttpFields" style={{ display: isHttp ? 'block' : 'none' }}>
          <label>URL</label>
          <input type="text" id="mcpUrl" name="mcpUrl" placeholder="https://mcp.example.com/mcp" defaultValue={server?.url ?? ''} />
          <label>Headers (KEY=VALUE, one per line)</label>
          <textarea id="mcpHeaders" name="mcpHeaders" placeholder="Authorization=Bearer ..." className="min-h-20" defaultValue={keyValueLines(server?.headers)} />
        </div>
        <label>Tools</label>
        <button type="button" className="btn btn-sm btn-ghost border border-white/10" id="mcpDiscoverBtn" onClick={(e) => discover(e.currentTarget.form!)}>Discover tools</button>
        <div className="field-hint" id="mcpDiscoverStatus">{discovery?.status}</div>
        {!!discovery?.tools.length && (
          <div id="mcpToolList" className="max-h-40 overflow-y-auto border border-white/10 rounded-md p-2 bg-white/[0.02]">
            {discovery.tools.map((t) => (
              <div key={t.name} className="text-[0.8rem] mb-1">
                <code>{t.name}</code>{t.description && <span className="field-hint"> {t.description.slice(0, 80)}</span>}
              </div>
            ))}
          </div>
        )}
        <label>Assigned Agents (empty = hidden from all agents)</label>
        <CheckList id="mcpAgentsCheckboxes" checked={server?.agent_ids || []} items={data.agents.map((a) => ({ id: a.id, label: a.name }))} />
        <Toggle id="mcpEnabled" label="Enabled" defaultChecked={server ? !!server.enabled : true} />
      </Modal>
    </>
  );
}
