// Everything the admin page loads, plus the pure helpers the tabs share.
// Rows are typed loosely: the API shapes live in agent/src/web/routes.

import { listOf } from '../../api.ts';

export type Row = Record<string, any> & { id: number };

export type AdminData = {
  models: Row[]; agents: Row[]; channels: Row[]; skills: Row[];
  siteConfig: Record<string, any>; crons: Row[]; sessions: Row[];
  settings: Record<string, any>; mcpServers: Row[];
  searchEngines: Row[]; searchProviders: string[];
};

export const EMPTY_DATA: AdminData = {
  models: [], agents: [], channels: [], skills: [], siteConfig: {}, crons: [],
  sessions: [], settings: {}, mcpServers: [], searchEngines: [], searchProviders: [],
};

// The admin boot replies, in loadAll's request order, mapped to AdminData. A
// failed request ({ error } body) only empties its own part of the page.
export function toAdminData(r: any[]): AdminData {
  const object = (body: any) => (body && typeof body === 'object' && !body.error ? body : {});
  return {
    models: listOf(r[0], 'models'), agents: listOf(r[1], 'agents'), channels: listOf(r[2], 'channels'),
    skills: listOf(r[3], 'skills'), siteConfig: object(r[4]), crons: listOf(r[5], 'jobs'),
    sessions: listOf(r[6], 'sessions'), settings: object(r[7]), mcpServers: listOf(r[8], 'servers'),
    searchEngines: listOf(r[9], 'engines'), searchProviders: listOf(r[9], 'providers'),
  };
}

// Browsers list canonical zones only, which leaves out UTC — the stored default.
const ZONES: string[] = Intl.supportedValuesOf?.('timeZone') ?? [];
export const TIMEZONES = ZONES.includes('UTC') ? ZONES : ['UTC', ...ZONES];

export function findById<T extends { id: unknown }>(rows: T[], id: unknown) {
  return rows.find((row) => String(row.id) === String(id));
}

// ---------- crons ----------

export type CronView = 'all' | 'active' | 'inactive' | 'failing';
export type CronSortKey = 'id' | 'agent' | 'target' | 'schedule' | 'prompt' | 'last' | 'enabled';
export type CronSort = { key: CronSortKey; dir: 'asc' | 'desc' };

// Default order: enabled first, id ascending.
export const DEFAULT_CRON_SORT: CronSort = { key: 'enabled', dir: 'desc' };

// Same column flips direction; a new column opens on the direction that is
// useful first — newest run and enabled-on at the top.
export function nextCronSort(current: CronSort, key: CronSortKey): CronSort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'last' || key === 'enabled' ? 'desc' : 'asc' };
}

export function cronMatchesFilter(j: Row, q: string) {
  if (!q) return true;
  const hay = [j.agent_name, j.prompt, j.description, j.expression, j.channel_name, j.chat_id, j.session_id, j.timezone]
    .filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q);
}

// A job counts as failing once it has actually run and the last run did not
// report ok. Never-run jobs are not failures.
export function isCronFailed(j: Row) { return !!j.last_run_at && j.last_status !== 'ok'; }

export function cronTargetKey(j: Row) {
  if (j.chat_id) return 'tg:' + (j.channel_name || '') + '/' + j.chat_id;
  if (j.session_id) return 'web:' + j.session_id;
  return '';
}

export function cronSortValue(j: Row, key: CronSortKey): string | number {
  if (key === 'id') return j.id;
  if (key === 'agent') return (j.agent_name || '').toLowerCase();
  if (key === 'target') return cronTargetKey(j).toLowerCase();
  if (key === 'schedule') return j.expression || j.run_at || '';
  if (key === 'prompt') return (j.prompt || '').toLowerCase();
  if (key === 'last') return j.last_run_at ? Date.parse(j.last_run_at) : 0;
  if (key === 'enabled') return j.enabled ? 1 : 0;
  return 0;
}

export function countCronViews(crons: Row[]): Record<CronView, number> {
  const active = crons.filter((j) => j.enabled).length;
  return { all: crons.length, active, inactive: crons.length - active, failing: crons.filter(isCronFailed).length };
}

export function selectCrons(crons: Row[], view: CronView, agentId: string, query: string, sort: CronSort) {
  const q = query.trim().toLowerCase();
  const dir = sort.dir === 'asc' ? 1 : -1;
  return crons
    .filter((j) => {
      if (view === 'active' && !j.enabled) return false;
      if (view === 'inactive' && j.enabled) return false;
      if (view === 'failing' && !isCronFailed(j)) return false;
      if (agentId && String(j.agent_id) !== agentId) return false;
      return cronMatchesFilter(j, q);
    })
    .sort((a, b) => {
      const av = cronSortValue(a, sort.key), bv = cronSortValue(b, sort.key);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.id - b.id;
    });
}

// The agents that own at least one job, for the filter dropdown.
export function cronAgents(crons: Row[]) {
  const seen = new Map<number, string>();
  for (const j of crons) {
    if (j.agent_id != null && !seen.has(j.agent_id)) seen.set(j.agent_id, j.agent_name || '#' + j.agent_id);
  }
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- events ----------

export function eventPreview(ev: Row) {
  if (ev.status === 'error') return ev.error || '(no error message)';
  return String(ev.output || ev.input || '').replace(/\s+/g, ' ').slice(0, 80);
}

// ---------- mcp ----------

export function parseKeyValueLines(text: string) {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

export function keyValueLines(map: Record<string, string> | null | undefined) {
  return Object.entries(map || {}).map(([k, v]) => k + '=' + v).join('\n');
}

// ---------- search engines ----------

// Long keys show only their first and last four characters.
export function maskKey(key: string) {
  return key.length > 8 ? key.slice(0, 4) + '…' + key.slice(-4) : key;
}
