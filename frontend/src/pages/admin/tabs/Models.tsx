import { useState } from 'react';
import { api } from '@/api';
import { PasswordInput } from '@/components/ui/password-input';
import { Modal, OnOff, RowActions, TabHeader, Table, Toggle, editingKey, editingRow, text, write, type Editing, type TabProps } from '../ui';

const PROVIDERS: Record<string, { baseUrl: string; modelPlaceholder: string; hasKey: boolean }> = {
  ollama: { baseUrl: 'http://ollama:11434', modelPlaceholder: 'gemma4:e2b', hasKey: false },
  openrouter: { baseUrl: 'https://openrouter.ai', modelPlaceholder: 'anthropic/claude-sonnet-4', hasKey: true },
  google: { baseUrl: 'https://generativelanguage.googleapis.com', modelPlaceholder: 'gemini-2.5-flash', hasKey: true },
};
const MEDIA = ['image', 'audio', 'video'];

type TestResult = { tone: 'info' | 'success' | 'error'; message: string } | null;

export function Models({ data, reload }: TabProps) {
  const [editing, setEditing] = useState<Editing>(null);
  const model = editingRow(editing);
  const [provider, setProvider] = useState('ollama');
  const [baseUrl, setBaseUrl] = useState('');
  const [testResult, setTestResult] = useState<TestResult>(null);

  function open(m: Editing) {
    const row = editingRow(m);
    setProvider(row?.provider ?? 'ollama');
    setBaseUrl(row?.base_url ?? PROVIDERS.ollama.baseUrl);
    setTestResult(null);
    setEditing(m);
  }

  function changeProvider(p: string) {
    setProvider(p);
    setBaseUrl(PROVIDERS[p].baseUrl);
  }

  function body(form: FormData) {
    return {
      name: text(form, 'modelName'), provider, base_url: baseUrl, model_id: text(form, 'modelModelId'),
      api_key: text(form, 'modelApiKey') || null, think: form.has('modelThink'),
      accepts: ['text', ...MEDIA.filter((m) => form.has('accept_' + m))],
    };
  }

  async function test(form: HTMLFormElement) {
    setTestResult({ tone: 'info', message: 'Testing connection...' });
    try {
      const { provider: p, base_url, model_id, api_key } = body(new FormData(form));
      const r = await api('POST', '/api/models/test', { provider: p, base_url, model_id, api_key });
      setTestResult(r.ok
        ? { tone: 'success', message: 'Connected! Reply: "' + (r.reply || '').slice(0, 100) + '"' }
        : { tone: 'error', message: 'Failed: ' + (r.error || 'unknown error') });
    } catch (err: any) {
      setTestResult({ tone: 'error', message: 'Error: ' + err.message });
    }
  }

  async function save(form: FormData) {
    const request = model ? api('PUT', '/api/models/' + model.id, body(form)) : api('POST', '/api/models', body(form));
    if (await write(request, reload, 'Model saved')) setEditing(null);
  }

  async function remove(id: number) {
    if (!confirm('Delete this model?')) return;
    await write(api('DELETE', '/api/models/' + id), reload);
  }

  const accepts: string[] = model?.accepts || ['text'];
  const toneClass = { info: 'bg-info/10 text-info', success: 'bg-success/10 text-success', error: 'bg-error/10 text-error' };

  return (
    <>
      <TabHeader title="Models" onNew={() => open('new')} newLabel="+ New Model" />
      <Table bodyId="modelsTable" head={<thead><tr><th>Name</th><th>Provider</th><th>Model ID</th><th>Think</th><th>Accepts</th><th></th></tr></thead>}>
        {data.models.map((m) => (
          <tr key={m.id}>
            <td><strong>{m.name}</strong></td><td>{m.provider}</td><td><code>{m.model_id}</code></td>
            <td><OnOff isOn={m.think} /></td>
            <td>{(m.accepts || ['text']).map((a: string) => <span key={a} className="badge badge-tag">{a}</span>)}</td>
            <RowActions onEdit={() => open(m)} onDelete={() => remove(m.id)} />
          </tr>
        ))}
      </Table>

      <Modal id="modelModal" title={model ? 'Edit Model' : 'New Model'} isOpen={!!editing} formKey={editingKey(editing)}
        onClose={() => setEditing(null)} onSave={save}
        buttons={<button type="button" className="btn btn-outline btn-info btn-cancel" onClick={(e) => test(e.currentTarget.form!)}>Test Connection</button>}>
        <label>Name</label>
        <input type="text" id="modelName" name="modelName" placeholder="gemma4-e2b" defaultValue={model?.name ?? ''} />
        <label>Provider</label>
        <select id="modelProvider" value={provider} onChange={(e) => changeProvider(e.target.value)}>
          <option value="ollama">Ollama (local)</option>
          <option value="openrouter">OpenRouter</option>
          <option value="google">Google Gemini</option>
        </select>
        <label>Base URL</label>
        <input type="text" id="modelBaseUrl" placeholder={PROVIDERS[provider].baseUrl} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        <label>Model ID</label>
        <input type="text" id="modelModelId" name="modelModelId" placeholder={PROVIDERS[provider].modelPlaceholder} defaultValue={model?.model_id ?? ''} />
        <div id="apiKeyRow" style={{ display: PROVIDERS[provider].hasKey ? 'block' : 'none' }}>
          <label>API Key</label>
          <PasswordInput id="modelApiKey" name="modelApiKey" placeholder="sk-or-..." defaultValue={model?.api_key ?? ''} strength={false} autoComplete="off" className="max-w-none" />
        </div>
        <Toggle id="modelThink" label="Enable thinking" defaultChecked={!!model?.think} />
        <label>Accepts</label>
        <div className="checks">
          <label><input type="checkbox" className="checkbox checkbox-primary checkbox-xs" id="acceptText" checked disabled /> text</label>
          {MEDIA.map((m) => (
            <label key={m}><input type="checkbox" className="checkbox checkbox-primary checkbox-xs" id={'accept' + m[0].toUpperCase() + m.slice(1)} name={'accept_' + m} defaultChecked={accepts.includes(m)} /> {m}</label>
          ))}
        </div>
        <div className="field-hint">Pick what the model can ingest directly. Unsupported types become an `[Attached: &lt;type&gt;]` hint in the prompt so the model still knows the user sent something.</div>
        {testResult && <div id="testResult" className={`mt-3 text-sm rounded-md px-3 py-2 ${toneClass[testResult.tone]}`}>{testResult.message}</div>}
      </Modal>
    </>
  );
}
