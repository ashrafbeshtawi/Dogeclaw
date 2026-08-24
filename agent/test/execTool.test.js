// Unit tests for the run_command tool (src/tools/exec.js): exit codes,
// timeout reporting, and output-truncation flags — the model must be able
// to tell partial output and killed processes apart from clean runs.
//
// The workspace env var must be set BEFORE the module graph loads config.js,
// so everything is imported dynamically after the override.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workspace = await mkdtemp(join(tmpdir(), 'dogeclaw-exec-test-'));
process.env.DOGECLAW_WORKSPACE = workspace;

const { register } = await import('../src/tools/exec.js');
const { ToolRegistry } = await import('../src/tools/index.js');
const config = (await import('../src/config.js')).default;
await mkdir(config.paths.files, { recursive: true });

const reg = new ToolRegistry();
register(reg);
const run = args => reg.execute('run_command', args);

test.after(() => rm(workspace, { recursive: true, force: true }));

test('clean run: stdout, exit code 0, no flags', async () => {
  const res = await run({ command: 'echo hi' });
  assert.equal(res.stdout, 'hi\n');
  assert.equal(res.exitCode, 0);
  assert.equal(res.timedOut, undefined);
  assert.equal(res.stdoutTruncated, undefined);
});

test('non-zero exit is reported without a timeout flag', async () => {
  const res = await run({ command: 'exit 3' });
  assert.equal(res.exitCode, 3);
  assert.equal(res.timedOut, undefined);
});

test('stdout over 10k chars is sliced and flagged', async () => {
  const res = await run({ command: 'head -c 20000 /dev/zero | tr "\\0" a' });
  assert.equal(res.stdout.length, 10000);
  assert.equal(res.stdoutTruncated, true);
});

test('stderr over 5k chars is sliced and flagged', async () => {
  const res = await run({ command: 'head -c 9000 /dev/zero | tr "\\0" b >&2' });
  assert.equal(res.stderr.length, 5000);
  assert.equal(res.stderrTruncated, true);
});

test('timeout kill is flagged as timedOut', async () => {
  const res = await run({ command: 'sleep 5', timeout_ms: 300 });
  assert.equal(res.timedOut, true);
});
