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

test('flushPrefix flushes the pending album before a following message', async () => {
  const order = [];
  const buf = createMediaGroupBuffer({
    delayMs: 1000,
    onFlush: async (parts) => { await sleep(5); order.push(parts); },
  });
  buf.add('42:album', 'img1');
  buf.add('42:album', 'img2');
  await buf.flushPrefix('42:');
  order.push('what is in these?');
  assert.deepEqual(order, [['img1', 'img2'], 'what is in these?']);
  assert.equal(buf.size, 0);
});

test('flushPrefix leaves other chats pending and does not flush twice', async () => {
  const flushes = [];
  const buf = createMediaGroupBuffer({ delayMs: 20, onFlush: parts => flushes.push(parts) });
  buf.add('1:g', 'a');
  buf.add('12:g', 'b');
  await buf.flushPrefix('1:');
  assert.deepEqual(flushes, [['a']]);
  assert.equal(buf.size, 1);
  await sleep(50);
  assert.deepEqual(flushes, [['a'], ['b']]);
});

test('flushPrefix waits for a part that is still downloading', async () => {
  const order = [];
  const buf = createMediaGroupBuffer({ delayMs: 1000, onFlush: parts => { order.push(parts); } });
  buf.add('42:album', 'img1');
  buf.add('42:album', sleep(20).then(() => 'img2'));
  await buf.flushPrefix('42:');
  order.push('what is in these?');
  assert.deepEqual(order, [['img1', 'img2'], 'what is in these?']);
});

test('the timer flush waits for pending parts and keeps arrival order', async () => {
  const flushes = [];
  const buf = createMediaGroupBuffer({ delayMs: 10, onFlush: parts => flushes.push(parts) });
  buf.add('k', sleep(40).then(() => 'slow'));
  buf.add('k', 'fast');
  await sleep(20);
  assert.equal(flushes.length, 0);
  await sleep(40);
  assert.deepEqual(flushes, [['slow', 'fast']]);
});

test('parts that resolve to null are left out, an empty group is not flushed', async () => {
  const flushes = [];
  const buf = createMediaGroupBuffer({ delayMs: 5, onFlush: parts => flushes.push(parts) });
  buf.add('a', 'x');
  buf.add('a', Promise.resolve(null));
  buf.add('b', Promise.resolve(null));
  await sleep(20);
  assert.deepEqual(flushes, [['x']]);
});

test('flushPrefix without a pending group does nothing', async () => {
  const flushes = [];
  const buf = createMediaGroupBuffer({ delayMs: 20, onFlush: parts => flushes.push(parts) });
  await buf.flushPrefix('42:');
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
