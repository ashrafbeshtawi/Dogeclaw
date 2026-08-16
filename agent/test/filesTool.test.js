// Unit tests for the file_operation tool (src/tools/files.js): the
// path-traversal guard (security boundary) and the read/write/list/delete
// round trip against a throwaway workspace.
//
// The workspace env var must be set BEFORE the module graph loads config.js,
// so everything is imported dynamically after the override.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workspace = await mkdtemp(join(tmpdir(), 'dogeclaw-files-test-'));
process.env.DOGECLAW_WORKSPACE = workspace;

const { register } = await import('../src/tools/files.js');
const { ToolRegistry } = await import('../src/tools/index.js');

const reg = new ToolRegistry();
register(reg);
const run = args => reg.execute('file_operation', args);

test.after(() => rm(workspace, { recursive: true, force: true }));

test('write → read round trip', async () => {
  assert.deepEqual(await run({ operation: 'write', path: 'notes.md', content: 'hello' }),
    { written: true, path: 'notes.md' });
  assert.deepEqual(await run({ operation: 'read', path: 'notes.md' }), { content: 'hello' });
});

test('write creates nested directories', async () => {
  await run({ operation: 'write', path: 'a/b/c.txt', content: 'deep' });
  assert.deepEqual(await run({ operation: 'read', path: 'a/b/c.txt' }), { content: 'deep' });
});

test('list returns entries with type', async () => {
  const res = await run({ operation: 'list', path: '.' });
  assert.ok(res.entries.some(e => e.name === 'notes.md' && e.type === 'file'));
  assert.ok(res.entries.some(e => e.name === 'a' && e.type === 'dir'));
});

test('list on a file returns an error', async () => {
  assert.deepEqual(await run({ operation: 'list', path: 'notes.md' }), { error: 'Not a directory' });
});

test('delete removes the file', async () => {
  await run({ operation: 'write', path: 'gone.txt', content: 'x' });
  assert.deepEqual(await run({ operation: 'delete', path: 'gone.txt' }), { deleted: true, path: 'gone.txt' });
  const res = await run({ operation: 'read', path: 'gone.txt' });
  assert.ok(res.error);
});

test('path traversal outside the workspace is blocked', async () => {
  for (const path of ['../outside.txt', '../../etc/passwd', 'a/../../outside.txt']) {
    assert.deepEqual(await run({ operation: 'read', path }),
      { error: 'Path traversal not allowed' }, `expected traversal block for ${path}`);
  }
});

test('".." segments that stay inside the workspace are allowed', async () => {
  assert.deepEqual(await run({ operation: 'read', path: 'a/../notes.md' }), { content: 'hello' });
});

test('unknown operation returns an error', async () => {
  assert.deepEqual(await run({ operation: 'chmod', path: 'notes.md' }),
    { error: 'Unknown operation: chmod' });
});
