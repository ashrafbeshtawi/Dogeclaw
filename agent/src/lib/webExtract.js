// HTML/JSON parsing for the web tools — the fragile half of web.js, split
// out so it can be tested against fixtures without any network. NOT
// dependency-free (cheerio): the stdlib-only unit stage skips its tests;
// CI runs them in the Playwright job after `npm ci` (see publish.yml).

import * as cheerio from 'cheerio';

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

// Parse DDG's html.duckduckgo.com results page.
export function parseDdgResults(html, limit = 8) {
  const $ = cheerio.load(html);
  const results = [];

  // :not(.result--ad) — DDG mixes ads into the same result markup.
  $('div.result:not(.result--ad)').each((i, el) => {
    if (results.length >= limit) return false;
    const title = $(el).find('a.result__a').text().trim();
    const href = $(el).find('a.result__a').attr('href');
    const snippet = $(el).find('.result__snippet').text().trim();
    if (title && href) {
      let realUrl = href;
      try {
        const parsed = new URL(href, 'https://duckduckgo.com');
        realUrl = parsed.searchParams.get('uddg') || href;
      } catch {}
      results.push({ title, url: realUrl, snippet: snippet.slice(0, 200) });
    }
  });

  // Zero parsed results is ambiguous: a genuinely empty query, or DDG's
  // bot-check page. Reporting the block as "no results found" makes the
  // agent state a falsehood — surface it as an error instead.
  if (!results.length && /anomaly|unusual traffic|challenge|captcha|bots use DuckDuckGo/i.test(html)) {
    throw new Error('DuckDuckGo blocked or rate-limited this search — results are unavailable right now');
  }

  return results;
}

// Map a Google Custom Search JSON API response body to search results.
export function mapGoogleResults(body) {
  return (body.items || []).map(item => ({
    title: item.title,
    url: item.link,
    snippet: (item.snippet || '').slice(0, 200),
  }));
}
