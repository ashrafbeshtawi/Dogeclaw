import * as cheerio from 'cheerio';

const USER_AGENT = 'Mozilla/5.0 (compatible; DogeClaw/1.0)';

async function fetchPage(url, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
      redirect: 'follow',
    });
    const html = await res.text();
    return { html, status: res.status, url: res.url };
  } finally {
    clearTimeout(timer);
  }
}

function extractText(html, selector) {
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

function extractLinks(html, baseUrl) {
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

async function searchDDG(query, limit = 8) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const { html } = await fetchPage(url);
  const $ = cheerio.load(html);
  const results = [];

  $('div.result').each((i, el) => {
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

  return results;
}

export function register(registry) {
  // --- web_search ---
  registry.register('web_search', {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web using DuckDuckGo and return results with titles, URLs, and snippets. Use this to find information, lookup facts, find documentation, etc. Examples: "javascript fetch API", "weather Berlin", "latest news on AI".',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          max_results: { type: 'number', description: 'Max results to return (default 8, max 20)' },
        },
        required: ['query'],
      },
    },
  }, async ({ query, max_results }) => {
    const results = await searchDDG(query, Math.min(max_results || 8, 20));
    return { query, results };
  });

  // --- web_fetch ---
  registry.register('web_fetch', {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch a URL and extract its text content. Optionally follow links to crawl multiple pages. Use this to read articles, documentation, API responses, or any webpage. Examples: fetch "https://example.com" to read it, fetch with depth=1 to also follow links on the page.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
          selector: { type: 'string', description: 'CSS selector to extract specific content (optional)' },
          depth: { type: 'number', description: 'How many levels of links to follow (0-2). Default 0.' },
          max_pages: { type: 'number', description: 'Max total pages when depth > 0 (default 5, max 15)' },
        },
        required: ['url'],
      },
    },
  }, async ({ url, selector, depth, max_pages }) => {
    const maxDepth = Math.min(depth || 0, 2);
    const maxPages = Math.min(max_pages || 5, 15);
    const visited = new Set();
    const pages = [];

    async function crawl(pageUrl, currentDepth) {
      if (visited.has(pageUrl) || pages.length >= maxPages) return;
      visited.add(pageUrl);

      try {
        const { html, status, url: finalUrl } = await fetchPage(pageUrl);
        const text = extractText(html, selector);
        const page = { url: finalUrl, status, text: text.slice(0, 8000) };

        if (currentDepth < maxDepth) {
          const links = extractLinks(html, finalUrl);
          page.links = links.slice(0, 30);
          for (const link of links) {
            if (pages.length >= maxPages) break;
            await crawl(link.url, currentDepth + 1);
          }
        }

        pages.push(page);
      } catch (err) {
        pages.push({ url: pageUrl, error: err.message });
      }
    }

    await crawl(url, 0);
    return { pages };
  });

  // --- web_research ---
  registry.register('web_research', {
    type: 'function',
    function: {
      name: 'web_research',
      description: 'Research a topic: searches the web, visits the top result pages, and returns combined content from all of them. This is the best tool for answering questions that need up-to-date information. Use this instead of web_search when you need actual page content, not just links. Examples: "latest news on Syria", "how to install Docker on Ubuntu", "Tesla stock price today", "current weather in Berlin".',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to research' },
          num_sites: { type: 'number', description: 'How many sites to visit (default 3, max 5)' },
        },
        required: ['query'],
      },
    },
  }, async ({ query, num_sites }) => {
    const sitesToVisit = Math.min(num_sites || 3, 5);

    // Step 1: Search
    const searchResults = await searchDDG(query, sitesToVisit + 4);
    if (!searchResults.length) return { query, sources: [], content: '(no search results found)' };

    // Step 2: Fetch top results in parallel
    const fetches = searchResults.slice(0, sitesToVisit + 3).map(async (result) => {
      try {
        const { html } = await fetchPage(result.url, 12000);
        const text = extractText(html);
        return {
          title: result.title,
          url: result.url,
          snippet: result.snippet,
          content: text.length >= 100 ? text.slice(0, 3000) : null,
        };
      } catch {
        return { title: result.title, url: result.url, snippet: result.snippet, content: null };
      }
    });

    const allPages = await Promise.all(fetches);

    // Step 3: Build report — use fetched content when available, fall back to search snippets
    const sources = [];
    const parts = [];
    let idx = 0;

    for (const p of allPages) {
      if (idx >= sitesToVisit) break;
      const text = p.content || p.snippet;
      if (!text) continue;
      idx++;
      sources.push({ title: p.title, url: p.url });
      const label = p.content ? '(full page)' : '(snippet)';
      parts.push(`--- Source ${idx}: ${p.title} ${label} ---\n${p.url}\n${text}`);
    }

    // If no pages had content, use all snippets
    if (parts.length === 0) {
      for (const r of searchResults.slice(0, sitesToVisit)) {
        if (r.snippet) {
          sources.push({ title: r.title, url: r.url });
          parts.push(`--- ${r.title} ---\n${r.url}\n${r.snippet}`);
        }
      }
    }

    return {
      query,
      sources,
      content: parts.join('\n\n') || '(no content could be extracted)',
    };
  });
}
