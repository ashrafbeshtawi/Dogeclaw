// Unit tests for Telegram album grouping (src/lib/mediaGroup.js).
// Run with: npm test (node --test, stdlib only — no framework).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createMediaGroupBuffer, mergeMediaParts } from '../src/lib/mediaGroup.js';

const emptyMedia = () => ({ images: null, audio: null, audioMime: null, video: null, videoMime: null });

test('buffer flushes all parts of a group once, in arrival order', async () => {
  const flushes = [];
  const buf = createMediaGroupBuffer({ delayMs: 20, onFlush: parts => flushes.push(parts) });
  buf.add('chat:g1', 'a');
  await sleep(5);
  buf.add('chat:g1', 'b');
  await sleep(50);
  assert.deepEqual(flushes, [['a', 'b']]);
  assert.equal(buf.size, 0);
});

test('each new part resets the quiet period', async () => {
  const flushes = [];
  const buf = createMediaGroupBuffer({ delayMs: 30, onFlush: parts => flushes.push(parts) });
  buf.add('k', 1);
  await sleep(20);
  buf.add('k', 2);
  await sleep(20);
  assert.equal(flushes.length, 0);
  await sleep(30);
  assert.deepEqual(flushes, [[1, 2]]);
});

test('different groups flush independently', async () => {
  const flushes = [];
  const buf = createMediaGroupBuffer({ delayMs: 20, onFlush: parts => flushes.push(parts) });
  buf.add('chat1:g', 'x');
  buf.add('chat2:g', 'y');
  await sleep(50);
  assert.deepEqual(flushes.sort(), [['x'], ['y']]);
});

test('clear() drops pending groups without flushing', async () => {
  const flushes = [];
  const buf = createMediaGroupBuffer({ delayMs: 20, onFlush: parts => flushes.push(parts) });
  buf.add('k', 1);
  buf.clear();
  await sleep(40);
  assert.equal(flushes.length, 0);
});

test('a throwing onFlush does not crash the process', async () => {
  const buf = createMediaGroupBuffer({ delayMs: 5, onFlush: async () => { throw new Error('boom'); } });
  buf.add('k', 1);
  await sleep(20);
});

test('merge concatenates images and keeps the caption', () => {
  const merged = mergeMediaParts([
    { text: 'look at these', media: { ...emptyMedia(), images: ['img1'] }, mediaHints: [], messageId: 10 },
    { text: '', media: { ...emptyMedia(), images: ['img2'] }, mediaHints: [], messageId: 11 },
  ]);
  assert.deepEqual(merged.media.images, ['img1', 'img2']);
  assert.equal(merged.text, 'look at these');
  assert.deepEqual(merged.mediaHints, []);
  assert.equal(merged.messageId, 10);
});

test('merge dedupes hints for media the model cannot consume', () => {
  const merged = mergeMediaParts([
    { text: '', media: emptyMedia(), mediaHints: ['image'], messageId: 1 },
    { text: '', media: emptyMedia(), mediaHints: ['image'], messageId: 2 },
  ]);
  assert.equal(merged.media.images, null);
  assert.deepEqual(merged.mediaHints, ['image']);
});

test('merge keeps the first video and hints the extra one', () => {
  const merged = mergeMediaParts([
    { text: '', media: { ...emptyMedia(), video: 'v1', videoMime: 'video/mp4' }, mediaHints: [], messageId: 1 },
    { text: '', media: { ...emptyMedia(), images: ['img'] }, mediaHints: [], messageId: 2 },
    { text: '', media: { ...emptyMedia(), video: 'v2', videoMime: 'video/webm' }, mediaHints: [], messageId: 3 },
  ]);
  assert.equal(merged.media.video, 'v1');
  assert.equal(merged.media.videoMime, 'video/mp4');
  assert.deepEqual(merged.media.images, ['img']);
  assert.deepEqual(merged.mediaHints, ['video']);
});

test('merge joins multiple captions', () => {
  const merged = mergeMediaParts([
    { text: 'first', media: emptyMedia(), mediaHints: [], messageId: 1 },
    { text: 'second', media: emptyMedia(), mediaHints: [], messageId: 2 },
  ]);
  assert.equal(merged.text, 'first\nsecond');
});
