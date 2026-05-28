import { writeFile, unlink, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import config from './config.js';
import { insertEventLog } from './db/eventLogs.js';

const WHISPER_TIMEOUT_MS = 120_000;
const WHISPER_OUTPUT_DIR = '/tmp';

/**
 * Transcribe audio (base64) to text using whisper.
 * Accepts any format ffmpeg can decode (ogg, mp3, wav, m4a, webm, etc.).
 *
 * Returns { text, durationMs, stdout, stderr }. Throws on failure with an
 * error whose `details` property carries the same shape for the caller to
 * surface or log.
 */
export async function transcribeAudio(base64Audio, mimeType) {
  const ext = mimeTypeToExt(mimeType);
  const stem = `_audio_${randomUUID()}`;
  const tmpFile = join(config.paths.files, `${stem}.${ext}`);
  // whisper writes <stem>.txt into --output_dir regardless of input dir.
  const txtFile = join(WHISPER_OUTPUT_DIR, `${stem}.txt`);
  const startedAt = Date.now();

  try {
    await writeFile(tmpFile, Buffer.from(base64Audio, 'base64'));

    const { stdout, stderr } = await new Promise((resolve, reject) => {
      execFile(
        'whisper',
        [tmpFile, '--model', 'base', '--output_format', 'txt', '--output_dir', WHISPER_OUTPUT_DIR],
        { timeout: WHISPER_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            const cleanStderr = filterWhisperWarnings(stderr || '');
            const durationMs = Date.now() - startedAt;
            const timedOut = err.killed && (err.signal === 'SIGTERM' || err.code === null);
            const reason = timedOut
              ? `timed out after ${Math.round(WHISPER_TIMEOUT_MS / 1000)}s`
              : (cleanStderr || err.message || `exited with code ${err.code}`);
            const wrapped = new Error(`Whisper failed: ${reason}`);
            wrapped.details = { stdout: stdout || '', stderr: stderr || '', durationMs };
            return reject(wrapped);
          }
          resolve({ stdout: stdout || '', stderr: stderr || '' });
        },
      );
    });

    // The canonical transcript lives in the .txt file. stdout often only
    // contains progress / timing noise and may be empty even for a successful
    // run, which used to make us falsely report "(no speech detected)".
    let text = '';
    try {
      text = (await readFile(txtFile, 'utf8')).trim();
    } catch {
      text = stdout.trim();
    }

    return {
      text: text || '(no speech detected)',
      durationMs: Date.now() - startedAt,
      stdout,
      stderr,
    };
  } finally {
    await unlink(tmpFile).catch(() => {});
    await unlink(txtFile).catch(() => {});
  }
}

/**
 * Convenience wrapper: transcribe + write an audio_transcription event log
 * (both success and error). Returns { text, eventLogId } or throws on failure
 * after logging the error.
 */
export async function transcribeAndLog(base64Audio, mimeType, ctx = {}) {
  let result;
  try {
    result = await transcribeAudio(base64Audio, mimeType);
  } catch (err) {
    const d = err.details || {};
    const event = await insertEventLog({
      kind: 'audio_transcription',
      refId: ctx.refId,
      status: 'error',
      input: describeAudioInput(base64Audio, mimeType),
      output: null,
      error: err.message,
      durationMs: d.durationMs,
      meta: {
        ...(ctx.meta || {}),
        mime_type: mimeType,
        stdout: truncate(d.stdout, 4096),
        stderr: truncate(d.stderr, 4096),
      },
    }).catch(logErr => {
      console.error('[audio] event log insert failed:', logErr.message);
      return null;
    });
    err.eventLogId = event?.id || null;
    throw err;
  }

  const event = await insertEventLog({
    kind: 'audio_transcription',
    refId: ctx.refId,
    status: 'success',
    input: describeAudioInput(base64Audio, mimeType),
    output: result.text,
    durationMs: result.durationMs,
    meta: {
      ...(ctx.meta || {}),
      mime_type: mimeType,
      stderr: truncate(result.stderr, 4096),
    },
  }).catch(err => {
    console.error('[audio] event log insert failed:', err.message);
    return null;
  });

  return { text: result.text, eventLogId: event?.id || null, durationMs: result.durationMs };
}

function describeAudioInput(base64Audio, mimeType) {
  const sizeKb = Math.round((base64Audio?.length || 0) * 0.75 / 1024);
  return `mime=${mimeType || 'unknown'} size~=${sizeKb}KB`;
}

function truncate(s, max) {
  if (!s) return s || '';
  return s.length > max ? s.slice(0, max) + '\n…[truncated]' : s;
}

// The CPU-only FP16 warning is benign — every whisper invocation on CPU emits
// it, and surfacing it as the error message hides the real cause when whisper
// actually fails. Strip it.
function filterWhisperWarnings(stderr) {
  return stderr
    .split('\n')
    .filter(line => !/FP16 is not supported on CPU/.test(line))
    .filter(line => !/UserWarning/.test(line))
    .filter(line => !/^\s*warnings\.warn/.test(line))
    .join('\n')
    .trim();
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
