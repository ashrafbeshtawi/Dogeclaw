// Boot, tab routing, and the bridge from the markup's inline handlers.
//
// The page wires ~40 handlers through inline onclick/onchange attributes, both
// in admin.html and in HTML the tab modules generate. Those attributes are
// evaluated in global scope, and a module's top-level functions are not
// globals — so every handler is republished on `window` here.
//
// That is deliberately the whole namespace rather than a hand-kept list: as a
// classic script every one of these was already a global, so this preserves
// exactly the previous reachability instead of inventing a narrower contract
// that a future onclick could silently fall outside of.

import { closeModal, load, state } from './store.js';
import * as agents from './agents.js';
import * as channels from './channels.js';
import * as crons from './crons.js';
import * as events from './events.js';
import * as mcp from './mcp.js';
import * as models from './models.js';
import * as search from './search.js';
import * as settings from './settings.js';
import * as skills from './skills.js';

const TABS = ['models', 'agents', 'skills', 'channels', 'mcp', 'search', 'crons', 'events', 'settings'];

export function showTab(name) {
    document.querySelectorAll('.tab-button').forEach(function(b){ b.classList.toggle('active', b.dataset.tab === name); });
    document.querySelectorAll('.section').forEach(function(s){ s.classList.toggle('active', s.id === 'tab-'+name); });
    if (window.location.hash !== '#'+name) {
        history.replaceState(null, '', '#'+name);
    }
    if (name === 'events') events.loadEvents();
}

export function initialTab() {
    var fromHash = (window.location.hash || '').replace(/^#/, '');
    return TABS.includes(fromHash) ? fromHash : 'models';
}

Object.assign(window,
    agents, channels, crons, events, mcp, models, search, settings, skills,
    { showTab, initialTab, closeModal, load, state });

window.addEventListener('hashchange', function(){ showTab(initialTab()); });
showTab(initialTab());
load();
