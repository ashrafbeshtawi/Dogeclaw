// UNIT: public/admin/store.js — shared state and the helpers every tab uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, stubFetch } from './dom.js';
import { state, esc, find, closeModal, timezoneOptions, onRender, load } from '../../src/web/public/admin/store.js';

test('esc neutralises every character that could break out of markup', () => {
  assert.equal(esc('<script>"x" & \'y\'</script>'),
    '&lt;script&gt;&quot;x&quot; &amp; \'y\'&lt;/script&gt;');
});

test('esc coerces nullish to an empty string', () => {
  // Called on optional DB columns all over the render functions.
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('esc blanks a falsy number — known quirk of the `s||""` guard', () => {
  // Documented, not endorsed: esc(0) is '' rather than '0'. Harmless today
  // because ids are stringified before escaping, but a numeric column
  // rendered through esc() would lose a legitimate zero.
  assert.equal(esc(0), '');
  assert.equal(esc('0'), '0');
});

test('find matches by id and returns undefined otherwise', () => {
  const rows = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }];
  assert.equal(find(rows, 2).name, 'b');
  assert.equal(find(rows, 99), undefined);
  // strict equality: the admin passes numbers, not the string from a dataset
  assert.equal(find(rows, '2'), undefined);
});

test('timezoneOptions marks exactly the selected zone', () => {
  const zone = Intl.supportedValuesOf('timeZone')[0];
  const html = timezoneOptions(zone);
  assert.match(html, new RegExp(`<option value="${zone}" selected>`));
  assert.equal((html.match(/ selected>/g) || []).length, 1);
});

test('timezoneOptions selects nothing for "UTC" — the stored default', () => {
  // Intl.supportedValuesOf('timeZone') contains no UTC identifier at all
  // (verified 418 zones, none matching /UTC/, in both Node and Chromium), yet
  // 'UTC' is what settings defaults to. So the Settings select renders with
  // no option marked and the browser shows the FIRST zone instead — and
  // saving without touching the dropdown would store that zone.
  //
  // Pre-existing: this code moved verbatim out of the old inline script.
  // Asserted here so the gap is visible; fixing it should make this fail.
  assert.equal(timezoneOptions('UTC').includes(' selected>'), false);
});

test('closeModal drops the open class', () => {
  const dom = installDom();
  try {
    const el = dom.el('someModal');
    el.classList.add('open');
    closeModal('someModal');
    assert.equal(el.classList.contains('open'), false);
  } finally { dom.restore(); }
});

test('state is a single mutable object, not re-exported bindings', () => {
  // load() replaces the arrays wholesale; an ES module import is a read-only
  // binding, so reading through `state` is what lets tabs see the new array.
  const before = state.models;
  state.models = [{ id: 1 }];
  assert.notEqual(state.models, before);
  state.models = before;
});

test('load populates state from the API and fires every registered renderer', async () => {
  const dom = installDom();
  const calls = [];
  onRender(() => calls.push('a'));
  onRender(() => calls.push('b'));

  const bodies = {
    '/api/models': { models: [{ id: 1 }] },
    '/api/agents': { agents: [{ id: 2 }] },
    '/api/channels': { channels: [{ id: 3 }] },
    '/api/skills': { skills: [{ id: 4 }] },
    '/api/config': { telegramMode: 'polling' },
    '/api/cron-jobs': { jobs: [{ id: 5 }] },
    '/api/sessions': { sessions: [{ id: 's' }] },
    '/api/settings': { timezone: 'UTC' },
    '/api/mcp': { servers: [{ id: 6 }] },
    '/api/search-engines': { engines: [{ id: 7 }], providers: ['google'] },
  };
  const restore = stubFetch(async path => ({ status: 200, json: async () => bodies[path] }));

  try {
    await load();
  } finally { restore(); dom.restore(); }

  assert.deepEqual(state.models, [{ id: 1 }]);
  assert.deepEqual(state.crons, [{ id: 5 }]);
  assert.deepEqual(state.searchProviders, ['google']);
  // renderers run so every tab redraws from one fetch round
  assert.deepEqual(calls, ['a', 'b']);
});

test('load tolerates endpoints that return no collection', async () => {
  const dom = installDom();
  // jobs/sessions/servers/engines are all `|| []` guarded — a fresh install
  // returns bodies without them.
  const restore = stubFetch(async () => ({ status: 200, json: async () => ({}) }));
  try {
    await load();
  } finally { restore(); dom.restore(); }

  assert.deepEqual(state.crons, []);
  assert.deepEqual(state.sessions, []);
  assert.deepEqual(state.mcpServers, []);
  assert.deepEqual(state.searchEngines, []);
});
