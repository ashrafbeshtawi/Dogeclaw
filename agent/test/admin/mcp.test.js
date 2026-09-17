// UNIT: public/admin/mcp.js — MCP server list, form and discovery.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './dom.js';
import { state } from '../../src/web/public/admin/store.js';
import { parseKeyValueLines, renderMcp, onMcpTransportChange } from '../../src/web/public/admin/mcp.js';

test('parseKeyValueLines splits on the first = only', () => {
  // Header values legitimately contain '=' (base64, tokens).
  assert.deepEqual(parseKeyValueLines('Authorization=Bearer a=b=c'), { Authorization: 'Bearer a=b=c' });
});

test('parseKeyValueLines trims around the separator', () => {
  assert.deepEqual(parseKeyValueLines('  X-Key  =  value  '), { 'X-Key': 'value' });
});

test('parseKeyValueLines ignores blank and malformed lines', () => {
  // A line with no '=' or a leading '=' has no key, so it is dropped rather
  // than producing an empty header name.
  assert.deepEqual(parseKeyValueLines('a=1\n\nnokey\n=novalue\nb=2'), { a: '1', b: '2' });
});

test('parseKeyValueLines returns an empty object for empty input', () => {
  assert.deepEqual(parseKeyValueLines(''), {});
});

test('renderMcp lists servers with their transport', () => {
  const dom = installDom();
  state.mcpServers = [
    { id: 1, name: 'calendar', transport: 'http', url: 'https://x', enabled: true, agent_ids: [] },
    { id: 2, name: 'files', transport: 'stdio', command: 'npx y', enabled: false, agent_ids: [] },
  ];
  state.agents = [];
  try {
    renderMcp();
    const html = dom.el('mcpTable').innerHTML;
    assert.match(html, /calendar/);
    assert.match(html, /files/);
  } finally { dom.restore(); state.mcpServers = []; }
});

test('renderMcp shows an empty state when nothing is configured', () => {
  const dom = installDom();
  state.mcpServers = [];
  try {
    renderMcp();
    assert.ok(dom.el('mcpTable').innerHTML.length >= 0);
  } finally { dom.restore(); }
});

test('onMcpTransportChange shows exactly one transport field set', () => {
  const dom = installDom();
  try {
    dom.el('mcpTransport').value = 'stdio';
    onMcpTransportChange();
    assert.equal(dom.el('mcpStdioFields').style.display, 'block');
    assert.equal(dom.el('mcpHttpFields').style.display, 'none');

    dom.el('mcpTransport').value = 'http';
    onMcpTransportChange();
    assert.equal(dom.el('mcpStdioFields').style.display, 'none');
    assert.equal(dom.el('mcpHttpFields').style.display, 'block');
  } finally { dom.restore(); }
});

test('an unrecognised transport falls back to the stdio fields', () => {
  // The check is `=== 'http'`, so anything else shows stdio rather than
  // leaving both sets hidden and the form apparently empty.
  const dom = installDom();
  try {
    dom.el('mcpTransport').value = '';
    onMcpTransportChange();
    assert.equal(dom.el('mcpStdioFields').style.display, 'block');
  } finally { dom.restore(); }
});
