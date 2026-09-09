// HTML extraction for the web tools — the fragile half of web.js, split
// out so it can be tested against fixtures without any network. Needs
// cheerio; CI installs the agent deps before running the unit tests
// (see publish.yml). Search-provider parsing lives in lib/searchProviders.js.

import * as cheerio from 'cheerio';

// nav/header/footer are stripped from the TEXT only — extractLinks reads the
// raw html, so navigation links stay available to the agent.
export function extractText(html, selector) {
  const $ = cheerio.load(html);
  $('script, style, nav, footer, header, iframe, noscript, svg').remove();

  if (selector) {
    const el = $(selector);
    return el.text().replace(/\s+/g, ' ').trim();
  }

  const content = $('article, main, [role="main"], .content, .post-content, .entry-content').first();
  const text = (content.length ? content : $('body')).text().replace(/\s+/g, ' ').trim();
  return text;
}

export function extractLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const links = [];
  const seen = new Set();
  $('a[href]').each((_, el) => {
    try {
      const href = new URL($(el).attr('href'), baseUrl).href;
      if (!seen.has(href) && href.startsWith('http')) {
        seen.add(href);
        const label = $(el).text().replace(/\s+/g, ' ').trim().slice(0, 80);
        links.push({ url: href, text: label || href });
      }
    } catch {}
  });
  return links;
}
