// Unit tests for the claim detector (src/lib/claimGuard.js): replies that
// claim a completed action must be flagged so the agent loop can force a
// retry when no tool call backs the claim.
// Run with: npm test (node --test, stdlib only — no framework).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimsAction } from '../src/lib/claimGuard.js';

test('claimsAction: flags completion claims', () => {
  assert.equal(claimsAction('Vitamin D done! ✅ Logged.'), true);
  assert.equal(claimsAction('Saved it to the dreams table.'), true);
  assert.equal(claimsAction('I scheduled the reminder for 9 PM.'), true);
  assert.equal(claimsAction('Habe ich gespeichert!'), true);
  assert.equal(claimsAction('Alles eingetragen.'), true);
});

test('claimsAction: leaves ordinary chat alone', () => {
  assert.equal(claimsAction('How was your Tuesday? Did you get to study?'), false);
  assert.equal(claimsAction('You should save money for the summer house.'), false);
  assert.equal(claimsAction('Go give Wissam his vitamin D!'), false);
  assert.equal(claimsAction(''), false);
  assert.equal(claimsAction(null), false);
});
