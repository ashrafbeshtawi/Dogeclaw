// UNIT: public/admin/main.js — boot, tab routing, and the window bridge.
//
// This module runs on import (it calls showTab and load at top level), so the
// stubs have to be in place before the dynamic import below. That import also
// makes this the one file that observes the boot sequence itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, stubFetch } from './dom.js';

const dom = installDom();

// Boot calls load(), which reads r[N].models / .agents / .channels / .skills
// WITHOUT a `|| []` guard (unlike jobs/sessions/servers/engines). An empty
// body therefore leaves those state slots undefined and every renderer throws
// on .map — so the stub returns realistic shapes rather than {}.
const BODIES = {
  '/api/models': { models: [] },
  '/api/agents': { agents: [] },
  '/api/channels': { channels: [] },
  '/api/skills': { skills: [] },
  '/api/config': { telegramMode: 'polling' },
};
const restoreFetch = stubFetch(async path => ({ status: 200, json: async () => BODIES[path] || {} }));

const replaced = [];
globalThis.history = { replaceState: (_s, _t, url) => replaced.push(url) };
globalThis.window = {
  location: { hash: '#crons' },
  addEventListener: (event, fn) => { globalThis.window['on:' + event] = fn; },
};

// Boot happens here.
const main = await import('../../src/web/public/admin/main.js');

test('boot selects the tab named by the hash', () => {
  assert.equal(main.initialTab(), 'crons');
});

test('an unknown hash falls back to the models tab', () => {
  globalThis.window.location.hash = '#not-a-tab';
  assert.equal(main.initialTab(), 'models');
  globalThis.window.location.hash = '';
  assert.equal(main.initialTab(), 'models');
});

test('every tab name the markup uses is accepted', () => {
  for (const name of ['models', 'agents', 'skills', 'channels', 'mcp', 'search', 'crons', 'events', 'settings']) {
    globalThis.window.location.hash = '#' + name;
    assert.equal(main.initialTab(), name, `${name} should be a valid tab`);
  }
});

test('showTab rewrites the hash without pushing history', () => {
  // replaceState, not pushState: switching tabs should not fill the back stack.
  const before = replaced.length;
  globalThis.window.location.hash = '#models';
  main.showTab('settings');
  assert.deepEqual(replaced.slice(before), ['#settings']);
});

test('showTab leaves the hash alone when it already matches', () => {
  const before = replaced.length;
  globalThis.window.location.hash = '#agents';
  main.showTab('agents');
  assert.equal(replaced.length, before);
});

test('a hashchange listener is registered so back/forward switch tabs', () => {
  assert.equal(typeof globalThis.window['on:hashchange'], 'function');
});

test('every handler the markup calls inline is published on window', () => {
  // Module top-level functions are not globals; inline onclick/onchange
  // attributes are evaluated in global scope. Anything missing here is a
  // button that silently does nothing.
  const REQUIRED = [
    'clearEvents', 'closeModal', 'discoverMcp', 'loadEvents', 'openAgentModal',
    'openChannelModal', 'openCronModal', 'openMcpModal', 'openModelModal',
    'openSearchEngineModal', 'openSkillModal', 'saveAgent', 'saveChannel',
    'saveCron', 'saveEventRetention', 'saveMcp', 'saveModel', 'saveSearchEngine',
    'saveSkill', 'saveTimezone', 'setCronSort', 'setCronView', 'showTab',
    'testModel', 'onCronScheduleTypeChange', 'onCronTargetTypeChange',
    'onMcpTransportChange', 'onProviderChange', 'onSearchProviderChange',
    'renderCrons',
    // referenced from HTML the modules generate, not from admin.html
    'deleteAgent', 'deleteChannel', 'deleteCron', 'deleteMcp', 'deleteModel',
    'deleteSearchEngine', 'deleteSkill', 'editAgent', 'editChannel', 'editCron',
    'editMcp', 'editModel', 'editSearchEngine', 'editSkill', 'moveSearchEngine',
    'openEventDetail',
  ];
  const missing = REQUIRED.filter(name => typeof globalThis.window[name] !== 'function');
  assert.deepEqual(missing, []);
});

test('shared state is reachable from global scope too', () => {
  assert.ok(globalThis.window.state);
  assert.ok(Array.isArray(globalThis.window.state.models));
});

test.after(() => { restoreFetch(); dom.restore(); });
