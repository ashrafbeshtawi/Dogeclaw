// UNIT: public/admin/channels.js — channel list and the webhook hint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './dom.js';
import { state } from '../../src/web/public/admin/store.js';
import { renderChannels, updateWebhookHint, openChannelModal } from '../../src/web/public/admin/channels.js';

const CHANNEL = {
  id: 1, agent_id: 1, type: 'telegram', name: 'ops-bot', enabled: true,
  response_mode: 'immediate', response_interval: null, allowed_users: [],
  webhook_id: 'abc-123',
};

test('renderChannels lists a row per channel', () => {
  const dom = installDom();
  state.channels = [CHANNEL, { ...CHANNEL, id: 2, name: 'alerts', enabled: false }];
  state.agents = [{ id: 1, name: 'Ops' }];
  try {
    renderChannels();
    const html = dom.el('channelsTable').innerHTML;
    assert.match(html, /ops-bot/);
    assert.match(html, /alerts/);
  } finally { dom.restore(); state.channels = []; state.agents = []; }
});

test('renderChannels never prints the bot token', () => {
  // The token is a secret the list must not leak into the DOM.
  const dom = installDom();
  state.channels = [{ ...CHANNEL, token: 'SECRET-TOKEN-VALUE' }];
  state.agents = [{ id: 1, name: 'Ops' }];
  try {
    renderChannels();
    assert.equal(dom.el('channelsTable').innerHTML.includes('SECRET-TOKEN-VALUE'), false);
  } finally { dom.restore(); state.channels = []; state.agents = []; }
});

test('the webhook hint says polling when that is the mode', () => {
  const dom = installDom();
  state.siteConfig = { telegramMode: 'polling' };
  try {
    updateWebhookHint(CHANNEL);
    assert.match(dom.el('webhookHint').textContent, /polling/i);
  } finally { dom.restore(); state.siteConfig = {}; }
});

test('the webhook hint shows the full path for a saved channel', () => {
  const dom = installDom();
  state.siteConfig = { telegramMode: 'webhook', webhookUrl: 'https://x.test' };
  try {
    updateWebhookHint(CHANNEL);
    assert.match(dom.el('webhookHint').innerHTML, /https:\/\/x\.test\/webhook\/abc-123/);
  } finally { dom.restore(); state.siteConfig = {}; }
});

test('the webhook hint explains that the path is minted on create', () => {
  // A new channel has no webhook_id yet, so there is no path to show.
  const dom = installDom();
  state.siteConfig = { telegramMode: 'webhook', webhookUrl: 'https://x.test' };
  try {
    updateWebhookHint(null);
    assert.match(dom.el('webhookHint').innerHTML, /minted when the channel is created/);
  } finally { dom.restore(); state.siteConfig = {}; }
});

test('the webhook hint stays empty when webhook mode has no URL configured', () => {
  const dom = installDom();
  state.siteConfig = { telegramMode: 'webhook', webhookUrl: null };
  try {
    updateWebhookHint(CHANNEL);
    assert.equal(dom.el('webhookHint').textContent, '');
  } finally { dom.restore(); state.siteConfig = {}; }
});

test('openChannelModal fills the form from an existing channel', async () => {
  const dom = installDom();
  state.channels = [CHANNEL];
  state.agents = [{ id: 1, name: 'Ops' }];
  state.siteConfig = { telegramMode: 'polling' };
  try {
    openChannelModal(1);
    assert.equal(dom.el('channelName').value, 'ops-bot');
    assert.equal(dom.el('channelMode').value, 'immediate');
    assert.equal(dom.el('channelEnabled').checked, true);
    assert.equal(dom.el('channelModal').classList.contains('open'), true);

    // The agent select is assigned in a setTimeout(0) so the options rendered
    // by renderAgents are in place first. Let that timer run, or it fires
    // after the test and touches a torn-down document.
    assert.equal(dom.el('channelAgent').value, '');
    await new Promise(r => setTimeout(r, 0));
    assert.equal(dom.el('channelAgent').value, 1);
  } finally { dom.restore(); state.channels = []; state.agents = []; state.siteConfig = {}; }
});
