// Fixture tests for the web tools' parsing (src/lib/webExtract.js) — the
// fragile half of the web tools. Needs cheerio, so CI installs the agent's
// deps before the unit-test step (see publish.yml).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ex from '../src/lib/webExtract.js';

test('extractText prefers article content and strips chrome', () => {
  const html = `<html><body>
    <nav>menu menu</nav><script>evil()</script>
    <article>The <b>actual</b>   story.</article>
    <footer>copyright</footer>
  </body></html>`;
  assert.equal(ex.extractText(html), 'The actual story.');
});

test('extractText falls back to body and honors a selector', () => {
  const html = '<html><body><div id="a">first</div><div id="b">second</div></body></html>';
  assert.equal(ex.extractText(html), 'firstsecond');
  assert.equal(ex.extractText(html, '#b'), 'second');
});

test('extractLinks resolves relative URLs, dedupes, skips non-http', () => {
  const html = `<body>
    <a href="/docs">Docs</a>
    <a href="/docs">Docs again</a>
    <a href="https://other.example/x">Other</a>
    <a href="mailto:x@example.com">mail</a>
  </body>`;
  const links = ex.extractLinks(html, 'https://site.example/page');
  assert.deepEqual(links.map(l => l.url), ['https://site.example/docs', 'https://other.example/x']);
  assert.equal(links[0].text, 'Docs');
});

// extractText strips <nav> from the TEXT only — the agent still gets
// navigation through extractLinks, which reads the raw html. This pins that
// division of labor.
test('links inside nav/header/footer stay available via extractLinks', () => {
  const html = `<body>
    <nav><a href="/about">About</a></nav>
    <header><a href="/home">Home</a></header>
    <article>content <a href="/story">Story</a></article>
    <footer><a href="/imprint">Imprint</a></footer>
  </body>`;
  assert.equal(ex.extractText(html), 'content Story');
  assert.deepEqual(
    ex.extractLinks(html, 'https://site.example/').map(l => l.url),
    ['https://site.example/about', 'https://site.example/home', 'https://site.example/story', 'https://site.example/imprint'],
  );
});

const ddgResult = (title, uddg, snippet, extra = '') => `
  <div class="result ${extra}">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(uddg)}">${title}</a>
    <a class="result__snippet">${snippet}</a>
  </div>`;

test('parseDdgResults decodes redirect URLs and excludes ads', () => {
  const html = `<body>
    ${ddgResult('Ad!', 'https://ads.example/', 'buy now', 'result--ad')}
    ${ddgResult('Real', 'https://real.example/page', 'a snippet')}
  </body>`;
  const results = ex.parseDdgResults(html, 8);
  assert.equal(results.length, 1);
  assert.deepEqual(results[0], { title: 'Real', url: 'https://real.example/page', snippet: 'a snippet' });
});

test('parseDdgResults respects the limit', () => {
  const html = [1, 2, 3].map(i => ddgResult(`R${i}`, `https://e.example/${i}`, 's')).join('');
  assert.equal(ex.parseDdgResults(html, 2).length, 2);
});

test('parseDdgResults surfaces the bot-check page as an error, not empty', () => {
  const blocked = '<body><div class="anomaly-modal">unusual traffic detected</div></body>';
  assert.throws(() => ex.parseDdgResults(blocked), /blocked or rate-limited/);
});

test('parseDdgResults returns [] for a genuinely empty results page', () => {
  assert.deepEqual(ex.parseDdgResults('<body><div class="no-results">nothing</div></body>'), []);
});

test('mapGoogleResults maps items and tolerates missing fields', () => {
  const body = { items: [
    { title: 'T', link: 'https://x.example/', snippet: 'S' },
    { title: 'NoSnippet', link: 'https://y.example/' },
  ] };
  assert.deepEqual(ex.mapGoogleResults(body), [
    { title: 'T', url: 'https://x.example/', snippet: 'S' },
    { title: 'NoSnippet', url: 'https://y.example/', snippet: '' },
  ]);
  assert.deepEqual(ex.mapGoogleResults({}), []);
});
