import '@/app.css';
import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { GooeyNav } from '@/components/ui/gooey-nav';
import { Toaster } from '@/components/ui/toast';
import { RareUiCredit } from '@/RareUiCredit';
import { api } from '@/api';
import { EMPTY_DATA, toAdminData, type AdminData } from './data';
import type { TabProps } from './ui';
import { Models } from './tabs/Models';
import { Agents } from './tabs/Agents';
import { Skills } from './tabs/Skills';
import { Channels } from './tabs/Channels';
import { Mcp } from './tabs/Mcp';
import { Search } from './tabs/Search';
import { Crons } from './tabs/Crons';
import { Events } from './tabs/Events';
import { Settings } from './tabs/Settings';

const TABS: { name: string; label: string; Tab?: ComponentType<TabProps> }[] = [
  { name: 'models', label: 'Models', Tab: Models },
  { name: 'agents', label: 'Agents', Tab: Agents },
  { name: 'skills', label: 'Skills', Tab: Skills },
  { name: 'channels', label: 'Channels', Tab: Channels },
  { name: 'mcp', label: 'MCP', Tab: Mcp },
  { name: 'search', label: 'Search', Tab: Search },
  { name: 'crons', label: 'Cron Jobs', Tab: Crons },
  { name: 'events', label: 'Events' },
  { name: 'settings', label: 'Settings' },
];

// The tab lives in the URL hash (/admin#crons) so reloads and links keep it.
function tabFromHash() {
  const name = window.location.hash.replace(/^#/, '');
  return TABS.some((t) => t.name === name) ? name : 'models';
}

async function loadAll(): Promise<AdminData> {
  return toAdminData(await Promise.all([
    api('GET', '/api/models'), api('GET', '/api/agents'), api('GET', '/api/channels'),
    api('GET', '/api/skills'), api('GET', '/api/config'), api('GET', '/api/cron-jobs'),
    api('GET', '/api/sessions'), api('GET', '/api/settings'), api('GET', '/api/mcp'),
    api('GET', '/api/search-engines'),
  ]));
}

function Admin() {
  const [tab, setTab] = useState(tabFromHash);
  const [data, setData] = useState<AdminData>(EMPTY_DATA);
  const reload = useCallback(async () => setData(await loadAll()), []);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function showTab(name: string) {
    setTab(name);
    if (window.location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  }

  const retention = data.settings.event_log_retention_days;
  const retentionDays = retention == null ? 14 : retention;

  return (
    <div className="dc-ambient min-h-screen bg-base-200 text-base-content flex flex-col">
      <div className="navbar min-h-0 py-3 px-4 sm:px-6 gap-3 sm:gap-4 bg-base-100/80 backdrop-blur border-b border-white/5 sticky top-0 z-20">
        <a href="/" title="Back to Chat"><img src="/static/logo.png" alt="DogeClaw" className="login-logo w-20 sm:w-28 -my-3 transition-transform hover:scale-110" /></a>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight bg-gradient-to-br from-white to-accent bg-clip-text text-transparent">DogeClaw Admin</h1>
          <p className="hidden sm:block text-xs text-base-content/45 tracking-wide">such control. very settings. wow.</p>
        </div>
        <a href="/" className="btn btn-ghost border border-white/10 text-primary">&larr;<span className="hidden sm:inline"> Back to Chat</span></a>
      </div>

      <div className="max-w-5xl w-full mx-auto px-4 sm:px-6 pt-5 pb-2 overflow-x-auto [scrollbar-width:none]">
        <GooeyNav id="adminTabs" size="md" activeColor="#dc2626" items={TABS.map((t) => t.label)}
          value={TABS.findIndex((t) => t.name === tab)} onChange={(i) => showTab(TABS[i].name)} />
      </div>

      <div className="max-w-5xl w-full mx-auto px-4 sm:px-6 pt-5 pb-8 flex-1">
        {TABS.map(({ name, Tab }) => (
          <div key={name} className={`section${name === tab ? ' active' : ''}`} id={'tab-' + name}>
            {Tab && <Tab data={data} reload={reload} />}
            {/* Events reload every time the tab is opened. */}
            {name === 'events' && tab === 'events' && <Events retentionDays={retentionDays} />}
            {name === 'settings' && <Settings data={data} reload={reload} retentionDays={retentionDays} />}
          </div>
        ))}
      </div>
      <RareUiCredit />
      <Toaster />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Admin />);
