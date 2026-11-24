// Unit tests for the pool setup in src/db/pool.js. pg is replaced by a fake
// Pool that is only an EventEmitter, so these tests check that an 'error' on
// an idle client is caught and does not stop the process.
// Run with: npm test (node --test, stdlib only — no framework).

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

const pools = [];

class FakePool extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    pools.push(this);
  }
  async end() {}
}

mock.module('pg', { defaultExport: { Pool: FakePool } });
mock.module('../src/config.js', {
  defaultExport: { database: { adminUrl: 'postgres://admin@db/x', agentUrl: 'postgres://agent@db/x' } },
});

const { getAdminPool, getAgentPool, shutdown } = await import('../src/db/pool.js');

for (const [name, getPool] of [['agent', getAgentPool], ['admin', getAdminPool]]) {
  test(`${name} pool: an idle client error is logged, not thrown`, async (t) => {
    const logged = t.mock.method(console, 'error', () => {});
    const pool = getPool();
    const err = Object.assign(new Error('terminating connection due to idle-in-transaction timeout'), { code: '25P03' });

    assert.doesNotThrow(() => pool.emit('error', err));
    assert.equal(logged.mock.callCount(), 1);
    assert.match(logged.mock.calls[0].arguments[0], new RegExp(`${name} pool.*idle-in-transaction timeout`));
    await shutdown();
  });
}
