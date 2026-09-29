// UNIT: public/admin/search.js — search engine list and priority ordering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './dom.js';
import { state } from '../../src/web/public/admin/store.js';
import { renderSearchEngines, onSearchProviderChange, openSearchEngineModal } from '../../src/web/public/admin/search.js';

const ENGINES = [
  { id: 1, provider: 'google', api_key: 'K1', cx: 'CX', enabled: true },
  { id: 2, provider: 'brave', api_key: 'K2', cx: null, enabled: false },
  { id: 3, provider: 'serper', api_key: 'K3', cx: null, enabled: true },
];

test('renderSearchEngines lists engines in priority order', () => {
  const dom = installDom();
  state.searchEngines = ENGINES;
  state.searchProviders = ['google', 'brave', 'serper'];
  try {
    renderSearchEngines();
    const html = dom.el('searchEnginesTable').innerHTML;
    assert.ok(html.indexOf('google') < html.indexOf('brave'));
    assert.ok(html.indexOf('brave') < html.indexOf('serper'));
  } finally { dom.restore(); state.searchEngines = []; }
});

test('the move arrows are disabled at the ends of the list', () => {
  // First row cannot move up, last cannot move down — otherwise the reorder
  // call would send an out-of-range index.
  const dom = installDom();
  state.searchEngines = ENGINES;
  state.searchProviders = ['google', 'brave', 'serper'];
  try {
    renderSearchEngines();
    const rows = dom.el('searchEnginesTable').innerHTML.split('<tr>').filter(Boolean);
    assert.match(rows[0], /disabled/);
    assert.match(rows[rows.length - 1], /disabled/);
    assert.equal(/disabled/.test(rows[1]), false, 'a middle row should move both ways');
  } finally { dom.restore(); state.searchEngines = []; }
});

test('a single engine can move neither way', () => {
  const dom = installDom();
  state.searchEngines = [ENGINES[0]];
  state.searchProviders = ['google'];
  try {
    renderSearchEngines();
    const html = dom.el('searchEnginesTable').innerHTML;
    assert.equal((html.match(/disabled/g) || []).length, 2);
  } finally { dom.restore(); state.searchEngines = []; }
});

test('a real API key is shown only as its first and last four characters', () => {
  const dom = installDom();
  const key = 'AIzaSyD-SECRET-MIDDLE-PART-9xyz';
  state.searchEngines = [{ ...ENGINES[0], api_key: key }];
  state.searchProviders = ['google'];
  try {
    renderSearchEngines();
    const html = dom.el('searchEnginesTable').innerHTML;
    assert.equal(html.includes(key), false, 'the full key must never reach the DOM');
    assert.equal(html.includes('SECRET-MIDDLE'), false);
    assert.match(html, /AIza…9xyz/);
  } finally { dom.restore(); state.searchEngines = []; }
});

test('a key of 8 characters or fewer is shown in full — documented, not endorsed', () => {
  // The mask only applies above 8 chars. Real provider keys are far longer,
  // so this is harmless in practice, but it is the actual behavior.
  const dom = installDom();
  state.searchEngines = [{ ...ENGINES[0], api_key: 'short' }];
  state.searchProviders = ['google'];
  try {
    renderSearchEngines();
    assert.match(dom.el('searchEnginesTable').innerHTML, /short/);
  } finally { dom.restore(); state.searchEngines = []; }
});

test('onSearchProviderChange reveals the cx field only for google', () => {
  // Google's Programmable Search needs a cx id; the other providers do not.
  const dom = installDom();
  try {
    dom.el('searchEngineProvider').value = 'google';
    onSearchProviderChange();
    assert.equal(dom.el('searchEngineCxField').style.display, 'block');

    dom.el('searchEngineProvider').value = 'brave';
    onSearchProviderChange();
    assert.equal(dom.el('searchEngineCxField').style.display, 'none');
  } finally { dom.restore(); }
});

test('openSearchEngineModal defaults a new engine to the first provider', () => {
  const dom = installDom();
  state.searchEngines = [];
  state.searchProviders = ['google', 'brave'];
  try {
    openSearchEngineModal(null);
    assert.equal(dom.el('searchEngineProvider').value, 'google');
  } finally { dom.restore(); state.searchProviders = []; }
});
