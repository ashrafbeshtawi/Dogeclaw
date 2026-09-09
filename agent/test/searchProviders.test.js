// Search providers + failover (src/lib/searchProviders.js): response
// mapping, provider request shape (stubbed fetch), priority failover, and
// the tool-visibility gate. Stdlib-only — runs in CI's no-install stage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapGoogleResults, mapBraveResults, searchGoogle, searchBrave,
  runSearchWithFailover, hideSearchTools,
} from '../src/lib/searchProviders.js';

function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

test('mapGoogleResults maps items and tolerates missing fields', () => {
  assert.deepEqual(mapGoogleResults({ items: [
    { title: 'T', link: 'https://x.example/', snippet: 'S' },
    { title: 'NoSnippet', link: 'https://y.example/' },
  ] }), [
    { title: 'T', url: 'https://x.example/', snippet: 'S' },
    { title: 'NoSnippet', url: 'https://y.example/', snippet: '' },
  ]);
  assert.deepEqual(mapGoogleResults({}), []);
});

test('mapBraveResults maps web.results and tolerates missing fields', () => {
  assert.deepEqual(mapBraveResults({ web: { results: [
    { title: 'T', url: 'https://x.example/', description: 'D' },
    { title: 'NoDesc', url: 'https://y.example/' },
  ] } }), [
    { title: 'T', url: 'https://x.example/', snippet: 'D' },
    { title: 'NoDesc', url: 'https://y.example/', snippet: '' },
  ]);
  assert.deepEqual(mapBraveResults({}), []);
});

test('searchGoogle builds the CSE request and surfaces API errors', async () => {
  let seenUrl;
  let restore = stubFetch(async (url) => {
    seenUrl = url;
    return { ok: true, json: async () => ({ items: [{ title: 'T', link: 'https://x/', snippet: 'S' }] }) };
  });
  try {
    const results = await searchGoogle('a b', 25, { api_key: 'K', cx: 'CX' });
    assert.match(seenUrl, /customsearch\/v1\?key=K&cx=CX&q=a%20b&num=10$/); // num capped at 10
    assert.equal(results[0].url, 'https://x/');
  } finally { restore(); }

  restore = stubFetch(async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'quota' } }) }));
  try {
    await assert.rejects(searchGoogle('q', 5, { api_key: 'K', cx: 'CX' }), /Google search failed \(429\): quota/);
  } finally { restore(); }
});

test('searchBrave sends the token header and surfaces API errors', async () => {
  let seenUrl, seenOpts;
  let restore = stubFetch(async (url, opts) => {
    seenUrl = url; seenOpts = opts;
    return { ok: true, json: async () => ({ web: { results: [{ title: 'T', url: 'https://x/', description: 'D' }] } }) };
  });
  try {
    const results = await searchBrave('a b', 30, { api_key: 'BK' });
    assert.match(seenUrl, /res\/v1\/web\/search\?q=a%20b&count=20$/); // count capped at 20
    assert.equal(seenOpts.headers['X-Subscription-Token'], 'BK');
    assert.equal(results[0].snippet, 'D');
  } finally { restore(); }

  restore = stubFetch(async () => ({ ok: false, status: 401, json: async () => ({ message: 'bad key' }) }));
  try {
    await assert.rejects(searchBrave('q', 5, { api_key: 'BK' }), /Brave search failed \(401\): bad key/);
  } finally { restore(); }
});

const okProvider = results => async () => results;
const failProvider = msg => async () => { throw new Error(msg); };

test('failover: first engine in priority order answers', async () => {
  const providers = { google: okProvider([{ title: 'g' }]), brave: okProvider([{ title: 'b' }]) };
  const engines = [{ provider: 'brave' }, { provider: 'google' }];
  assert.deepEqual(await runSearchWithFailover(engines, 'q', 5, providers), [{ title: 'b' }]);
});

test('failover: a failing engine hands over to the next', async () => {
  const providers = { google: failProvider('quota'), brave: okProvider([{ title: 'b' }]) };
  const engines = [{ provider: 'google' }, { provider: 'brave' }];
  assert.deepEqual(await runSearchWithFailover(engines, 'q', 5, providers), [{ title: 'b' }]);
});

test('failover: every engine failing throws an aggregate error', async () => {
  const providers = { google: failProvider('quota'), brave: failProvider('bad key') };
  const engines = [{ provider: 'google' }, { provider: 'brave' }];
  await assert.rejects(
    runSearchWithFailover(engines, 'q', 5, providers),
    /All search engines failed — google: quota; brave: bad key/,
  );
});

test('failover: unknown provider is skipped, empty engine list throws', async () => {
  const providers = { brave: okProvider([{ title: 'b' }]) };
  const engines = [{ provider: 'bing' }, { provider: 'brave' }];
  assert.deepEqual(await runSearchWithFailover(engines, 'q', 5, providers), [{ title: 'b' }]);
  await assert.rejects(runSearchWithFailover([], 'q', 5, providers), /none configured/);
});

test('hideSearchTools removes search tools only when no engine is active', () => {
  const entries = [
    { name: 'web_fetch', meta: null },
    { name: 'web_search', meta: { requiresSearchEngine: true } },
    { name: 'web_research', meta: { requiresSearchEngine: true } },
  ];
  assert.deepEqual(hideSearchTools(entries, false).map(e => e.name), ['web_fetch']);
  assert.equal(hideSearchTools(entries, true), entries);
});
