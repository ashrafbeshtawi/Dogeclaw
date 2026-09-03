// Ownership rules for agent-managed skills: create stamps the creator and
// auto-assigns, update/delete only touch rows the agent created, and no
// agent context means no skill management at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSkillHandlers } from '../src/lib/skillTools.js';

function fakeQuery(results = []) {
  const calls = [];
  let i = 0;
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return results[i++] ?? { rows: [], rowCount: 0 };
  };
  query.calls = calls;
  return query;
}

const ctx = { agentId: 7 };

test('createSkill stamps the creator and auto-assigns the skill', async () => {
  const q = fakeQuery([
    { rows: [{ id: 42, name: 'pw-s', description: 'd' }], rowCount: 1 },
    { rows: [], rowCount: 1 },
  ]);
  const res = await makeSkillHandlers(q).createSkill({ name: 'pw-s', description: 'd', content: 'c' }, ctx);
  assert.equal(res.id, 42);
  assert.deepEqual(q.calls[0].params, ['pw-s', 'd', 'c', 7]);
  assert.match(q.calls[0].sql, /created_by_agent_id/);
  assert.match(q.calls[1].sql, /INSERT INTO agent_skills/);
  assert.deepEqual(q.calls[1].params, [7, 42]);
});

test('updateSkill is constrained to the creating agent', async () => {
  const q = fakeQuery([{ rows: [{ id: 42 }], rowCount: 1 }]);
  await makeSkillHandlers(q).updateSkill({ skill_id: 42, content: 'new' }, ctx);
  assert.match(q.calls[0].sql, /created_by_agent_id = \$5/);
  assert.deepEqual(q.calls[0].params, [null, null, 'new', 42, 7]);
});

test('updateSkill on a foreign or admin skill returns an error', async () => {
  const q = fakeQuery([{ rows: [], rowCount: 0 }]);
  const res = await makeSkillHandlers(q).updateSkill({ skill_id: 1, name: 'x' }, ctx);
  assert.match(res.error, /not created by you/);
});

test('deleteSkill is constrained to the creating agent', async () => {
  const q = fakeQuery([{ rowCount: 1 }]);
  const res = await makeSkillHandlers(q).deleteSkill({ skill_id: 42 }, ctx);
  assert.equal(res.ok, true);
  assert.match(q.calls[0].sql, /created_by_agent_id = \$2/);
  assert.deepEqual(q.calls[0].params, [42, 7]);
});

test('deleteSkill on a foreign or admin skill returns an error', async () => {
  const q = fakeQuery([{ rowCount: 0 }]);
  const res = await makeSkillHandlers(q).deleteSkill({ skill_id: 1 }, ctx);
  assert.match(res.error, /not created by you/);
});

test('all handlers refuse to run without an agent context', async () => {
  const q = fakeQuery();
  const h = makeSkillHandlers(q);
  for (const call of [
    h.createSkill({ name: 'x' }, {}),
    h.updateSkill({ skill_id: 1 }, null),
    h.deleteSkill({ skill_id: 1 }, {}),
  ]) {
    const res = await call;
    assert.match(res.error, /agent context/);
  }
  assert.equal(q.calls.length, 0);
});

test('missing required args return errors, not queries', async () => {
  const q = fakeQuery();
  const h = makeSkillHandlers(q);
  assert.match((await h.createSkill({}, ctx)).error, /name is required/);
  assert.match((await h.updateSkill({}, ctx)).error, /skill_id is required/);
  assert.match((await h.deleteSkill({}, ctx)).error, /skill_id is required/);
  assert.equal(q.calls.length, 0);
});
