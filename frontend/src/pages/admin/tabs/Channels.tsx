import { useState } from 'react';
import { api } from '@/api';
import type { Row } from '../data';
import { Modal, OnOff, RowActions, TabHeader, Table, Toggle, editingKey, editingRow, text, write, type Editing, type TabProps } from '../ui';

function WebhookHint({ config, channel }: { config: Record<string, any>; channel: Row | null }) {
  if (config.telegramMode === 'polling') return <>Using polling mode (dev).</>;
  if (config.telegramMode !== 'webhook' || !config.webhookUrl) return null;
  return channel?.webhook_id
    ? <>Webhook: <code>{config.webhookUrl + '/webhook/' + channel.webhook_id}</code></>
    : <>Webhook path is minted when the channel is created.</>;
}

export function Channels({ data, reload }: TabProps) {
  const [editing, setEditing] = useState<Editing>(null);
  const channel = editingRow(editing);
  const config = data.siteConfig;

  async function save(form: FormData) {
    const body = {
      name: text(form, 'channelName'), type: text(form, 'channelType'), agent_id: parseInt(text(form, 'channelAgent')),
      token: text(form, 'channelToken'), allowed_users: text(form, 'channelUsers').split(',').map(Number).filter(Boolean),
      response_mode: text(form, 'channelMode'), response_interval: text(form, 'channelInterval') || null,
      enabled: form.has('channelEnabled'),
    };
    const request = channel ? api('PUT', '/api/channels/' + channel.id, body) : api('POST', '/api/channels', body);
    if (await write(request, reload, 'Channel saved')) setEditing(null);
  }

  async function remove(id: number) {
    if (!confirm('Delete this channel?')) return;
    await write(api('DELETE', '/api/channels/' + id), reload);
  }

  return (
    <>
      <TabHeader title="Channels" onNew={() => setEditing('new')} newLabel="+ New Channel" />
      <Table bodyId="channelsTable" head={<thead><tr><th>Name</th><th>Type</th><th>Agent</th><th>Mode</th><th>Enabled</th><th></th></tr></thead>}>
        {data.channels.map((c) => (
          <tr key={c.id}>
            <td><strong>{c.name}</strong></td><td>{c.type}</td><td>{c.agent_name}</td>
            <td>{c.response_mode}{c.response_interval ? ' / ' + c.response_interval : ''}</td>
            <td><OnOff isOn={c.enabled} /></td>
            <RowActions onEdit={() => setEditing(c)} onDelete={() => remove(c.id)} />
          </tr>
        ))}
      </Table>
      <div className="hint" id="telegramModeHint">
        {config.telegramMode === 'webhook' && config.webhookUrl
          ? <>Telegram mode: <strong>webhook</strong> — <code>{config.webhookUrl}</code></>
          : <>Telegram mode: <strong>polling</strong> (dev) — set <code>DOGECLAW_TELEGRAM_MODE=webhook</code> for production.</>}
      </div>

      <Modal id="channelModal" title={channel ? 'Edit Channel' : 'New Channel'} isOpen={!!editing} formKey={editingKey(editing)}
        onClose={() => setEditing(null)} onSave={save}>
        <label>Name</label>
        <input type="text" id="channelName" name="channelName" placeholder="my-telegram-bot" defaultValue={channel?.name ?? ''} />
        <div className="field-hint">Display name only — the webhook path is a stable id minted at creation, so renaming is always safe.</div>
        <label>Type</label>
        <select id="channelType" name="channelType" defaultValue={channel?.type ?? 'telegram'}><option value="telegram">Telegram</option></select>
        <label>Agent</label>
        <select id="channelAgent" name="channelAgent" defaultValue={channel?.agent_id}>
          {data.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <label>Bot Token</label>
        <input type="text" id="channelToken" name="channelToken" placeholder="123456:ABC-DEF..." defaultValue={channel?.token ?? ''} />
        <div className="field-hint" id="webhookHint"><WebhookHint config={config} channel={channel} /></div>
        <label>Allowed Users (comma-separated Telegram user IDs)</label>
        <input type="text" id="channelUsers" name="channelUsers" placeholder="748203222" defaultValue={channel?.allowed_users?.join(',') ?? ''} />
        <label>Response Mode</label>
        <select id="channelMode" name="channelMode" defaultValue={channel?.response_mode ?? 'immediate'}>
          <option value="immediate">Immediate</option><option value="periodic">Periodic</option>
        </select>
        <label>Interval (for periodic, e.g. 30m, 1h)</label>
        <input type="text" id="channelInterval" name="channelInterval" placeholder="30m" defaultValue={channel?.response_interval ?? ''} />
        <Toggle id="channelEnabled" label="Enabled" defaultChecked={channel ? channel.enabled !== false : true} />
      </Modal>
    </>
  );
}
