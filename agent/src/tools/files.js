import { readFile, writeFile, readdir, unlink, mkdir, stat } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import config from '../config.js';

function safePath(userPath) {
  const resolved = resolve(config.paths.files, userPath);
  const rel = relative(config.paths.files, resolved);
  if (rel.startsWith('..')) throw new Error('Path traversal not allowed');
  return resolved;
}

export function register(registry) {
  registry.register('file_operation', {
    type: 'function',
    function: {
      name: 'file_operation',
      description: 'Read, write, list, or delete files in the agent workspace. Examples: list "." to see all files, write "notes.md" with content, read "config.json", delete "old.txt". Use this to persist data between conversations.',
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['read', 'write', 'list', 'delete'], description: 'The operation to perform' },
          path: { type: 'string', description: 'Relative path within the workspace' },
          content: { type: 'string', description: 'File content (for write operation)' },
        },
        required: ['operation', 'path'],
      },
    },
  }, async ({ operation, path, content }) => {
    const target = safePath(path);

    switch (operation) {
      case 'read': {
        const data = await readFile(target, 'utf-8');
        return { content: data.slice(0, 50000) };
      }
      case 'write': {
        await mkdir(join(target, '..'), { recursive: true });
        await writeFile(target, content || '', 'utf-8');
        return { written: true, path };
      }
      case 'list': {
        const info = await stat(target);
        if (!info.isDirectory()) return { error: 'Not a directory' };
        const entries = await readdir(target, { withFileTypes: true });
        return {
          entries: entries.map(e => ({
            name: e.name,
            type: e.isDirectory() ? 'dir' : 'file',
          })),
        };
      }
      case 'delete': {
        await unlink(target);
        return { deleted: true, path };
      }
      default:
        return { error: `Unknown operation: ${operation}` };
    }
  });
}
