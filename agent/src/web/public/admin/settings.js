import { state, api, timezoneOptions, load, onRender } from './store.js';

export function renderSettings() {
    document.getElementById('settingTimezone').innerHTML = timezoneOptions(state.settings.timezone || 'UTC');
    var retention = state.settings.event_log_retention_days;
    document.getElementById('settingEventRetention').value = (retention == null ? 14 : retention);
    document.getElementById('eventsRetentionLabel').textContent = (retention == null ? 14 : retention);
}

export async function saveEventRetention() {
    var n = parseInt(document.getElementById('settingEventRetention').value, 10);
    if (!Number.isFinite(n) || n <= 0) return alert('Retention must be a positive integer');
    var r = await api('PUT','/api/settings/event_log_retention_days',{ value: n });
    if (r && r.error) return alert(r.error);
    await load();
}


export async function saveTimezone() {
    var v = document.getElementById('settingTimezone').value.trim();
    if (!v) return alert('Timezone required');
    var r = await api('PUT','/api/settings/timezone',{ value: v });
    if (r && r.error) return alert(r.error);
    await load();
}

onRender(renderSettings);
