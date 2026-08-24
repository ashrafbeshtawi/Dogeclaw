import { execFile } from 'node:child_process';
import config from '../config.js';

export function register(registry) {
  registry.register('run_command', {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute a shell command in the container. Working directory is the agent workspace. Examples: "ls -la", "curl https://example.com", "cat /etc/os-release", "df -h", "python3 -c \'print(2+2)\'", "git clone https://...".',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to run' },
          timeout_ms: { type: 'number', description: 'Timeout in ms (default 30000, max 120000)' },
        },
        required: ['command'],
      },
    },
  }, async ({ command, timeout_ms }) => {
    const timeout = Math.min(timeout_ms || 30000, 120000);
    return new Promise((resolve) => {
      execFile('/bin/bash', ['-c', command], {
        timeout,
        cwd: config.paths.files,
        maxBuffer: 1024 * 1024,
      }, (err, stdout, stderr) => {
        // Tell the model when it's looking at partial output — silently
        // sliced stdout is indistinguishable from a command that printed
        // exactly this much. Same for timeouts vs ordinary failures:
        // a timeout kill has killed=true and no exit code, while the
        // maxBuffer kill carries an ERR_CHILD_* code.
        resolve({
          stdout: stdout.slice(0, 10000),
          stderr: stderr.slice(0, 5000),
          exitCode: err ? (err.code || 1) : 0,
          ...(err?.killed && !err.code && { timedOut: true }),
          ...(stdout.length > 10000 && { stdoutTruncated: true }),
          ...(stderr.length > 5000 && { stderrTruncated: true }),
        });
      });
    });
  });
}
