import { useState } from 'react';
import { api } from '@/api';
import { toast } from '@/components/ui/toast';
import { TIMEZONES } from '../data';
import { Table, write, type TabProps } from '../ui';

export function Settings({ data, reload, retentionDays }: TabProps & { retentionDays: number }) {
  // The inputs are keyed by the stored values so a reload shows what was saved.
  const timezone = data.settings.timezone || 'UTC';

  return (
    <>
      <div className="flex items-center gap-3 mb-4"><h2 className="text-lg font-bold">Settings</h2></div>
      <Table bodyId="settingsTable" head={null}>
        <tr>
          <td className="w-52"><strong>Timezone</strong></td>
          <td>
            <TimezoneSetting key={timezone} value={timezone} onSave={(value) => write(api('PUT', '/api/settings/timezone', { value }), reload, 'Timezone saved')} />
          </td>
        </tr>
        <tr>
          <td><strong>Event log retention (days)</strong></td>
          <td>
            <RetentionSetting key={retentionDays} value={retentionDays} onSave={(value) => write(api('PUT', '/api/settings/event_log_retention_days', { value }), reload, 'Retention saved')} />
          </td>
        </tr>
      </Table>
      <div className="hint">Timezone is the default for new cron jobs. Event log retention controls how long cron-run and audio-transcription logs are kept before the daily cleanup tick deletes them. Web search providers are configured on the Search tab.</div>
    </>
  );
}

function TimezoneSetting({ value, onSave }: { value: string; onSave: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <select id="settingTimezone" className="select select-sm w-full sm:w-72" value={draft} onChange={(e) => setDraft(e.target.value)}>
        {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
      </select>
      <button className="btn btn-primary btn-sm" onClick={() => onSave(draft)}>Save</button>
    </div>
  );
}

function RetentionSetting({ value, onSave }: { value: number; onSave: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  function save() {
    const n = parseInt(draft, 10);
    if (!Number.isFinite(n) || n <= 0) return toast.error('Retention must be a positive integer');
    onSave(n);
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input type="number" id="settingEventRetention" min={1} step={1} className="input input-sm w-28" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <button className="btn btn-primary btn-sm" onClick={save}>Save</button>
    </div>
  );
}
