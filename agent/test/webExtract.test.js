// Fixture tests for the web tools' HTML extraction (src/lib/webExtract.js).
// Needs cheerio, so CI installs the agent's deps before the unit-test step
// (see publish.yml). Search-provider parsing is covered in
// searchProviders.test.js.
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
