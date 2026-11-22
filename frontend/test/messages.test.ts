import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateByKey } from '../src/pages/index/messages.ts';

test('updateByKey changes only the message with that key', () => {
  const list = [{ key: 1, content: 'a' }, { key: 2, content: 'b' }, { key: 3, content: 'c' }];
  const next = updateByKey(list, 2, (m) => ({ content: m.content + '!' }));
  assert.deepEqual(next.map((m) => m.content), ['a', 'b!', 'c']);
});

test('updateByKey leaves another session untouched when the reply is not in the list', () => {
  const otherSession = [{ key: 7, content: 'old question' }, { key: 8, content: 'old answer' }];
  assert.equal(updateByKey(otherSession, 5, () => ({ content: 'late token' })), otherSession);
});
