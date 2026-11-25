// Unit tests for the shared request-body presence check (src/lib/requireFields.js):
// one error shape for every router, naming all required fields.
// Run with: npm test (node --test, stdlib only — no framework).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireFields } from '../src/lib/requireFields.js';

test('requireFields: all present returns the picked fields', () => {
  assert.deepEqual(
    requireFields({ name: 'a', model_id: 'm', extra: 1 }, ['name', 'model_id']),
    { fields: { name: 'a', model_id: 'm' } },
  );
});

test('requireFields: a missing or empty field returns the error', () => {
  assert.deepEqual(requireFields({}, ['name']), { error: 'name required' });
  assert.deepEqual(requireFields({ name: '' }, ['name']), { error: 'name required' });
  assert.deepEqual(requireFields({ name: 'a', model_id: null }, ['name', 'model_id']), { error: 'name and model_id required' });
  assert.deepEqual(
    requireFields({ agent_id: 1, name: 'bot' }, ['agent_id', 'type', 'name']),
    { error: 'agent_id, type, and name required' },
  );
});

test('requireFields: no body counts as every field missing', () => {
  assert.deepEqual(requireFields(undefined, ['name']), { error: 'name required' });
  assert.deepEqual(requireFields('name', ['name']), { error: 'name required' });
});
