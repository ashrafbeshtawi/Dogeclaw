// UNIT: public/admin/skills.js — skill list and its modal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './dom.js';
import { state } from '../../src/web/public/admin/store.js';
import { renderSkills, openSkillModal } from '../../src/web/public/admin/skills.js';

const SKILL = { id: 7, name: 'summarise', description: 'condense text', agent_ids: [1] };

test('renderSkills lists a row per skill', () => {
  const dom = installDom();
  state.skills = [SKILL, { ...SKILL, id: 8, name: 'translate' }];
  state.agents = [];
  try {
    renderSkills();
    const html = dom.el('skillsTable').innerHTML;
    assert.match(html, /summarise/);
    assert.match(html, /translate/);
    assert.match(html, /condense text/);
  } finally { dom.restore(); state.skills = []; }
});

test('renderSkills escapes a skill description', () => {
  const dom = installDom();
  state.skills = [{ ...SKILL, description: '<script>x</script>' }];
  state.agents = [];
  try {
    renderSkills();
    assert.equal(dom.el('skillsTable').innerHTML.includes('<script>x'), false);
  } finally { dom.restore(); state.skills = []; }
});

test('openSkillModal fills the form from an existing skill', () => {
  const dom = installDom();
  state.skills = [SKILL];
  state.agents = [{ id: 1, name: 'Ops' }];
  try {
    openSkillModal(7);
    assert.equal(dom.el('skillName').value, 'summarise');
    assert.equal(dom.el('skillModal').classList.contains('open'), true);
  } finally { dom.restore(); state.skills = []; state.agents = []; }
});

test('the agent picker pre-checks the agents a skill is already on', () => {
  const dom = installDom();
  state.skills = [SKILL];
  state.agents = [{ id: 1, name: 'Ops' }, { id: 2, name: 'Research' }];
  try {
    openSkillModal(7);
    const html = dom.el('skillAgentsCheckboxes').innerHTML;
    assert.match(html, /value="1" checked/);
    assert.equal(/value="2" checked/.test(html), false);
  } finally { dom.restore(); state.skills = []; state.agents = []; }
});

test('openSkillModal with no skill clears the form', () => {
  const dom = installDom();
  state.agents = [];
  try {
    dom.el('skillName').value = 'left over';
    openSkillModal(null);
    assert.equal(dom.el('skillName').value, '');
  } finally { dom.restore(); }
});
