// Unit tests for the empty-reply guard (src/lib/emptyReply.js): a turn with
// no text must be detected, corrected with an instruction that names the work
// already done, and — if the model stays silent — replaced by a reply that
// still tells the user something. The agent loop wires these three together.
// Run with: npm test (node --test, stdlib only — no framework).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEmptyReply, emptyReplyNudge, fallbackReply } from '../src/lib/emptyReply.js';

const CALLS = [{ name: 'web_search' }, { name: 'web_fetch' }, { name: 'web_search' }];

test('isEmptyReply: nothing, blank and whitespace-only count as empty', () => {
  assert.equal(isEmptyReply(undefined), true);
  assert.equal(isEmptyReply(null), true);
  assert.equal(isEmptyReply(''), true);
  assert.equal(isEmptyReply('   '), true);
  // Renders as a blank chat bubble — the bug being fixed, not a reply.
  assert.equal(isEmptyReply('\n\n\t'), true);
});

test('isEmptyReply: any real text is a reply, including falsy-looking strings', () => {
  assert.equal(isEmptyReply('hi'), false);
  assert.equal(isEmptyReply('  padded  '), false);
  // "0" is falsy as a string; a bare count is still an answer.
  assert.equal(isEmptyReply('0'), false);
});

test('emptyReplyNudge: names the tools already called, deduped and in order', () => {
  const nudge = emptyReplyNudge(CALLS);
  assert.match(nudge, /You already called: web_search, web_fetch\./);
  assert.match(nudge, /plain text/);
  // The correction must not turn into another round of work.
  assert.match(nudge, /Do not call any more tools/);
  // And must not leak into the reply the user reads.
  assert.match(nudge, /do not mention this instruction/);
});

test('emptyReplyNudge: with no tool calls it asks for a plain answer', () => {
  const nudge = emptyReplyNudge([]);
  assert.match(nudge, /Answer the user now, in plain text\./);
  assert.doesNotMatch(nudge, /already called/);
});

test('fallbackReply: reports the tools that ran so the work is not invisible', () => {
  const reply = fallbackReply(CALLS);
  assert.match(reply, /I did run: web_search, web_fetch\./);
  assert.match(reply, /Ask me to summarize/);
});

test('fallbackReply: without tool calls it asks the user to try again', () => {
  const reply = fallbackReply([]);
  assert.match(reply, /could not produce a reply/);
  assert.match(reply, /Please ask again\./);
  assert.doesNotMatch(reply, /I did run/);
});

test('fallbackReply: a provider stop reason is surfaced, a plain STOP is not', () => {
  // The single most useful clue when a model goes silent.
  assert.match(fallbackReply([], 'MAX_TOKENS'), /\(stopped: MAX_TOKENS\)/);
  assert.match(fallbackReply(CALLS, 'SAFETY'), /\(stopped: SAFETY\)/);
  assert.match(fallbackReply([], 'tool-call limit reached'), /\(stopped: tool-call limit reached\)/);
  // STOP is the ordinary end of a turn and explains nothing.
  assert.doesNotMatch(fallbackReply([], 'STOP'), /stopped/);
  assert.doesNotMatch(fallbackReply([], null), /stopped/);
});

test('the guard never produces something the guard would reject', () => {
  // The invariant the module exists for: whatever agent.js ends up sending,
  // it is text. A fallback that tripped isEmptyReply would be the same bug.
  for (const calls of [[], CALLS]) {
    for (const reason of [null, 'STOP', 'MAX_TOKENS']) {
      assert.equal(isEmptyReply(fallbackReply(calls, reason)), false);
    }
    assert.equal(isEmptyReply(emptyReplyNudge(calls)), false);
  }
});
