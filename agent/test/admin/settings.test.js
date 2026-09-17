// UNIT: public/admin/settings.js — the settings form.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './dom.js';
import { state } from '../../src/web/public/admin/store.js';
import { renderSettings } from '../../src/web/public/admin/settings.js';

test('renderSettings fills the timezone picker from stored settings', () => {
  const dom = installDom();
  const zone = Intl.supportedValuesOf('timeZone')[0];
  state.settings = { timezone: zone };
  try {
    renderSettings();
    assert.match(dom.el('settingTimezone').innerHTML, new RegExp(`value="${zone}" selected`));
  } finally { dom.restore(); state.settings = {}; }
});

test('retention falls back to 14 days when unset', () => {
  // null and undefined both mean "never configured", and both must show the
  // default rather than an empty box that would save as NaN.
  const dom = installDom();
  state.settings = {};
  try {
    renderSettings();
    assert.equal(dom.el('settingEventRetention').value, 14);
    assert.equal(dom.el('eventsRetentionLabel').textContent, 14);
  } finally { dom.restore(); }
});

test('an explicit retention value is shown as stored', () => {
  const dom = installDom();
  state.settings = { event_log_retention_days: 30 };
  try {
    renderSettings();
    assert.equal(dom.el('settingEventRetention').value, 30);
    assert.equal(dom.el('eventsRetentionLabel').textContent, 30);
  } finally { dom.restore(); state.settings = {}; }
});

test('a retention of zero is preserved rather than treated as unset', () => {
  // `== null` is the guard, so 0 survives — a `|| 14` would have silently
  // rewritten it to the default.
  const dom = installDom();
  state.settings = { event_log_retention_days: 0 };
  try {
    renderSettings();
    assert.equal(dom.el('settingEventRetention').value, 0);
  } finally { dom.restore(); state.settings = {}; }
});
