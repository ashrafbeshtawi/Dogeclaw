// Unit-style coverage for the media-placeholder helper. After removing
// Whisper, the agent forwards media bytes only when the model's `accepts`
// list covers the type; otherwise it appends a `[Attached: <type>]`
// placeholder so the model still knows an attachment came in.
//
// composeUserText lives in its own pure module (no DB, no LLM) so we can
// hit it directly from the test runner. We use a dynamic import() because
// the agent code is ESM while the test bundle is CommonJS.

const { test, expect } = require('@playwright/test');

let composeUserText;

test.beforeAll(async () => {
  ({ composeUserText } = await import('../../agent/src/lib/composeUserText.js'));
});

test.describe('composeUserText', () => {
  test('no media → text unchanged', () => {
    expect(composeUserText('hello', {}, ['text'])).toBe('hello');
  });

  test('empty text, no media → empty', () => {
    expect(composeUserText('', {}, ['text'])).toBe('');
  });

  test('audio attached, model accepts → no placeholder', () => {
    expect(composeUserText('hi', { audio: 'AAAA' }, ['text', 'audio'])).toBe('hi');
  });

  test('audio attached, model does NOT accept → placeholder', () => {
    expect(composeUserText('hi', { audio: 'AAAA' }, ['text'])).toBe('hi\n[Attached: audio]');
  });

  test('image attached, model does NOT accept → placeholder', () => {
    expect(composeUserText('hi', { images: ['IMG'] }, ['text'])).toBe('hi\n[Attached: image]');
  });

  test('video attached, model does NOT accept → placeholder', () => {
    expect(composeUserText('hi', { video: 'VID' }, ['text'])).toBe('hi\n[Attached: video]');
  });

  test('mediaHints add placeholders without bytes', () => {
    // Telegram uses this path: don't download the bytes if the model
    // can't consume them anyway, just hint.
    expect(composeUserText('hi', { mediaHints: ['video'] }, ['text']))
      .toBe('hi\n[Attached: video]');
  });

  test('multiple unsupported media in stable order', () => {
    const out = composeUserText('', { images: ['x'], audio: 'y', video: 'z' }, ['text']);
    expect(out).toBe('[Attached: image] [Attached: audio] [Attached: video]');
  });

  test('mixed: some accepted, some not', () => {
    // image bytes go straight to the LLM; audio just notes it.
    const out = composeUserText('look at this', { images: ['IMG'], audio: 'A' }, ['text', 'image']);
    expect(out).toBe('look at this\n[Attached: audio]');
  });

  test('mediaHints union with bytes — duplicates collapse', () => {
    // Defensive: caller pass both bytes and hint — we don't double-render.
    const out = composeUserText('hi', { audio: 'A', mediaHints: ['audio'] }, ['text']);
    expect(out).toBe('hi\n[Attached: audio]');
  });
});
