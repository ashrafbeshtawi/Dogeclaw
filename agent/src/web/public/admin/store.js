// Shared state and the helpers every tab needs.
//
// The state lives on one object rather than as exported bindings because
// load() replaces the arrays wholesale, and an ES module import is a
// read-only binding — `import { models }` could never see the new array.
// Reading `state.models` always sees the current one.

export const state = {
  models: [], agents: [], channels: [], skills: [], siteConfig: {},
  crons: [], sessions: [], settings: {}, events: [],
  mcpServers: [], searchEngines: [], searchProviders: [],
};

const TIMEZONES = (typeof Intl !== 'undefined' && Intl.supportedValuesOf)
    ? Intl.supportedValuesOf('timeZone')
    : ['UTC'];

export function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
export function find(arr,id) { return arr.find(function(x){return x.id===id;}); }
export function closeModal(id){document.getElementById(id).classList.remove('open');}

export function timezoneOptions(selected) {
    return TIMEZONES.map(function(tz){
        return '<option value="'+esc(tz)+'"'+(tz===selected?' selected':'')+'>'+esc(tz)+'</option>';
    }).join('');
}

export async function api(method, path, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    var res = await fetch(path, opts);
    if (res.status === 401) return window.location.href = '/login';
    return res.json();
}

// Each tab registers its own renderer instead of load() naming them all.
// That is what keeps this module free of imports: store would otherwise have
// to import every tab, and every tab already imports store.
const renderers = [];
export function onRender(fn) { renderers.push(fn); }

export async function load() {
    var r = await Promise.all([
        api('GET','/api/models'),
        api('GET','/api/agents'),
        api('GET','/api/channels'),
        api('GET','/api/skills'),
        api('GET','/api/config'),
        api('GET','/api/cron-jobs'),
        api('GET','/api/sessions'),
        api('GET','/api/settings'),
        api('GET','/api/mcp'),
        api('GET','/api/search-engines'),
    ]);
    state.models = r[0].models; state.agents = r[1].agents; state.channels = r[2].channels;
    state.skills = r[3].skills; state.siteConfig = r[4];
    state.crons = r[5].jobs || []; state.sessions = r[6].sessions || []; state.settings = r[7] || {};
    state.mcpServers = r[8].servers || [];
    state.searchEngines = r[9].engines || [];
    state.searchProviders = r[9].providers || [];
    renderers.forEach(function(fn){ fn(); });
    var mh = document.getElementById('telegramModeHint');
    mh.innerHTML = state.siteConfig.telegramMode === 'webhook' && state.siteConfig.webhookUrl
        ? 'Telegram mode: <strong>webhook</strong> &mdash; <code>' + esc(state.siteConfig.webhookUrl) + '</code>'
        : 'Telegram mode: <strong>polling</strong> (dev) &mdash; set <code>DOGECLAW_TELEGRAM_MODE=webhook</code> for production.';
}
