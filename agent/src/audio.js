import { writeFile, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import config from './config.js';

/**
 * Transcribe audio (base64) to text using whisper.
 * Accepts any format ffmpeg can decode (ogg, mp3, wav, m4a, webm, etc.)
 */
export async function transcribeAudio(base64Audio, mimeType) {
  const ext = mimeTypeToExt(mimeType);
  const tmpFile = join(config.paths.files, `_audio_${randomUUID()}.${ext}`);

  try {
    await writeFile(tmpFile, Buffer.from(base64Audio, 'base64'));

    const text = await new Promise((resolve, reject) => {
      execFile('whisper', [tmpFile, '--model', 'base', '--output_format', 'txt', '--output_dir', '/tmp'], {
        timeout: 120000,
      }, (err, stdout, stderr) => {
        if (err) return reject(new Error(`Whisper failed: ${stderr || err.message}`));
        // Whisper outputs to stdout and also creates a .txt file
        const output = stdout.trim();
        resolve(output || '(no speech detected)');
      });
    });

    return text;
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

function mimeTypeToExt(mime) {
  if (!mime) return 'ogg';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp3') || mime.includes('mpeg')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('m4a') || mime.includes('mp4')) return 'm4a';
  return 'ogg';
}
