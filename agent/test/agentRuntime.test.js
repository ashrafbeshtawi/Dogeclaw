// toModelConfig is the single place the provider/accepts defaults are applied,
// for both the agent join and the channel join that backs the Telegram
// runtime model swap. Pure function, no DB needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toModelConfig } from '../src/db/agentRuntime.js';

test('maps a full row straight through', () => {
  assert.deepEqual(toModelConfig({
    base_url: 'http://x', model_id: 'gemma3:1b', think: true,
    accepts: ['text', 'image'], provider: 'openrouter', api_key: 'K',
  }), {
    base_url: 'http://x', model_id: 'gemma3:1b', think: true,
    accepts: ['text', 'image'], provider: 'openrouter', apiKey: 'K',
  });
});

test('applies the provider and accepts defaults in one place', () => {
  const cfg = toModelConfig({ model_id: 'm' });
  assert.equal(cfg.provider, 'ollama');
  assert.deepEqual(cfg.accepts, ['text']);
});

test('a row with no model is not runnable', () => {
  // every caller treats null as "no model assigned"
  assert.equal(toModelConfig({ base_url: 'http://x', provider: 'openrouter' }), null);
  assert.equal(toModelConfig(null), null);
  assert.equal(toModelConfig(undefined), null);
});

test('a channel row works the same as an agent row', () => {
  // the Telegram manager passes a channel join carrying the same model
  // columns — that is what lets a channel override the model at runtime
  const channel = { id: 7, name: 'ops', agent_id: 3, model_id: 'm', provider: 'google', api_key: 'G' };
  assert.equal(toModelConfig(channel).provider, 'google');
  assert.equal(toModelConfig(channel).apiKey, 'G');
});
