// UNIT: public/admin/models.js — model list and the provider-dependent form.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './dom.js';
import { state } from '../../src/web/public/admin/store.js';
import { renderModels, onProviderChange, openModelModal } from '../../src/web/public/admin/models.js';

const MODEL = {
  id: 1, name: 'local', provider: 'ollama', model_id: 'gemma3:1b',
  think: false, accepts: ['text'], base_url: 'http://o', api_key: null,
};

test('renderModels lists a row per model with its provider and think state', () => {
  const dom = installDom();
  state.models = [MODEL, { ...MODEL, id: 2, name: 'remote', provider: 'openrouter', think: true }];
  try {
    renderModels();
    const html = dom.el('modelsTable').innerHTML;
    assert.match(html, /local/);
    assert.match(html, /remote/);
    assert.match(html, /ollama/);
    assert.match(html, /openrouter/);
    // the think column reads on/off — the flag that silently did nothing for
    // OpenRouter until it was actually consumed
    assert.match(html, />on</);
    assert.match(html, />off</);
  } finally { dom.restore(); state.models = []; }
});

test('renderModels escapes a model name rather than injecting it', () => {
  const dom = installDom();
  state.models = [{ ...MODEL, name: '<img src=x onerror=1>' }];
  try {
    renderModels();
    const html = dom.el('modelsTable').innerHTML;
    assert.equal(html.includes('<img src=x'), false);
    assert.match(html, /&lt;img/);
  } finally { dom.restore(); state.models = []; }
});

test('onProviderChange reveals the API key only for remote providers', () => {
  const dom = installDom();
  try {
    dom.el('modelProvider').value = 'ollama';
    onProviderChange();
    const local = dom.el('apiKeyRow').style.display;

    dom.el('modelProvider').value = 'openrouter';
    onProviderChange();
    assert.notEqual(dom.el('apiKeyRow').style.display, local);
  } finally { dom.restore(); }
});

test('openModelModal fills the form from an existing model', () => {
  const dom = installDom();
  state.models = [MODEL];
  try {
    openModelModal(1);
    assert.equal(dom.el('modelName').value, 'local');
    assert.equal(dom.el('modelModelId').value, 'gemma3:1b');
    assert.equal(dom.el('modelModal').classList.contains('open'), true);
  } finally { dom.restore(); state.models = []; }
});

test('openModelModal with no model clears the form for a new one', () => {
  const dom = installDom();
  try {
    dom.el('modelName').value = 'left over';
    openModelModal(null);
    assert.equal(dom.el('modelName').value, '');
  } finally { dom.restore(); }
});
