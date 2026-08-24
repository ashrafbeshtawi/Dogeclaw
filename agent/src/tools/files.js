import { readFile, writeFile, appendFile, readdir, unlink, mkdir, stat } from 'node:fs/promises';
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
      description: 'Read, write, append, list, or delete files in the agent workspace. Examples: list "." to see all files, write "notes.md" with content, append a line to "log.md", read "config.json", delete "old.txt". Use this to persist data between conversations.',
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['read', 'write', 'append', 'list', 'delete'], description: 'The operation to perform' },
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
        // Flag sliced reads — silently cut content is indistinguishable
        // from a file that ends there.
        return {
          content: data.slice(0, 50000),
          ...(data.length > 50000 && { truncated: true, totalChars: data.length }),
        };
      }
      case 'write': {
        await mkdir(join(target, '..'), { recursive: true });
        await writeFile(target, content || '', 'utf-8');
        return { written: true, path };
      }
      case 'append': {
        await mkdir(join(target, '..'), { recursive: true });
        await appendFile(target, content || '', 'utf-8');
        return { appended: true, path };
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
