// UNIT: public/admin/agents.js — agent list and its modal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './dom.js';
import { state } from '../../src/web/public/admin/store.js';
import { renderAgents, openAgentModal } from '../../src/web/public/admin/agents.js';

const AGENT = { id: 1, name: 'Ops', system_prompt: 'be brief', model_id: 3, model_name: 'local', skill_ids: [] };

test('renderAgents lists a row per agent', () => {
  const dom = installDom();
  state.agents = [AGENT, { ...AGENT, id: 2, name: 'Research' }];
  state.skills = [];
  try {
    renderAgents();
    const html = dom.el('agentsTable').innerHTML;
    assert.match(html, /Ops/);
    assert.match(html, /Research/);
  } finally { dom.restore(); state.agents = []; }
});

test('renderAgents also refills the channel-agent picker', () => {
  // The channel modal's agent select is populated here, so an agent added on
  // one tab is immediately selectable on another without a reload.
  const dom = installDom();
  state.agents = [AGENT];
  state.skills = [];
  try {
    renderAgents();
    assert.match(dom.el('channelAgent').innerHTML, /<option value="1">Ops<\/option>/);
  } finally { dom.restore(); state.agents = []; }
});

test('renderAgents escapes an agent name', () => {
  const dom = installDom();
  state.agents = [{ ...AGENT, name: '<b>x</b>' }];
  state.skills = [];
  try {
    renderAgents();
    assert.equal(dom.el('agentsTable').innerHTML.includes('<b>x</b>'), false);
  } finally { dom.restore(); state.agents = []; }
});

test('openAgentModal fills the form from an existing agent', () => {
  const dom = installDom();
  state.agents = [AGENT];
  state.skills = [];
  try {
    openAgentModal(1);
    assert.equal(dom.el('agentName').value, 'Ops');
    assert.equal(dom.el('agentPrompt').value, 'be brief');
    assert.equal(dom.el('agentModal').classList.contains('open'), true);
  } finally { dom.restore(); state.agents = []; }
});

test('the skills picker explains itself when no skills exist', () => {
  const dom = installDom();
  state.agents = [AGENT];
  state.skills = [];
  try {
    openAgentModal(1);
    const html = dom.el('agentSkillsCheckboxes').innerHTML;
    assert.match(html, /No skills yet\. Create skills first\./);
    // the copy the state rewrite corrupted once; pinned so it cannot regress
    assert.equal(html.includes('state.'), false);
  } finally { dom.restore(); }
});

test('the skills picker lists a checkbox per skill', () => {
  const dom = installDom();
  state.agents = [AGENT];
  state.skills = [{ id: 7, name: 'summarise' }, { id: 8, name: 'translate' }];
  try {
    openAgentModal(1);
    const html = dom.el('agentSkillsCheckboxes').innerHTML;
    assert.match(html, /summarise/);
    assert.match(html, /translate/);
  } finally { dom.restore(); state.skills = []; state.agents = []; }
});
