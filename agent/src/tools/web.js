import { fetchPage } from '../lib/fetchPage.js';
import { getSetting } from '../db/settings.js';
import { extractText, extractLinks, parseDdgResults, mapGoogleResults } from '../lib/webExtract.js';

async function searchDDG(query, limit = 8) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const { html } = await fetchPage(url);
  return parseDdgResults(html, limit);
}

// Google Custom Search JSON API. num caps at 10 per request — good enough
// for the callers (web_research visits at most 5+3 pages).
async function searchGoogle(query, limit, { apiKey, cx }) {
  const url = 'https://www.googleapis.com/customsearch/v1'
    + `?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(cx)}`
    + `&q=${encodeURIComponent(query)}&num=${Math.min(limit, 10)}`;
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Google search failed (${res.status}): ${body.error?.message || 'unknown error'}`);
  }
  return mapGoogleResults(body);
}

// Provider dispatch: Google when credentials are configured in settings
// (admin UI → Settings), DDG scrape as keyless fallback — also when Google
// errors (e.g. daily quota), so search degrades instead of dying.
async function runSearch(query, limit) {
  const [apiKey, cx] = await Promise.all([
    getSetting('google_search_api_key'),
    getSetting('google_search_cx'),
  ]);
  if (apiKey && cx) {
    try {
      return await searchGoogle(query, limit, { apiKey, cx });
    } catch (err) {
      console.error('[web] Google search failed, falling back to DDG:', err.message);
    }
  }
  return searchDDG(query, limit);
}

export function register(registry) {
  // --- web_search ---
  registry.register('web_search', {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web and return results with titles, URLs, and snippets. Use this to find information, lookup facts, find documentation, etc. Examples: "javascript fetch API", "weather Berlin", "latest news on AI".',
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
    const results = await runSearch(query, Math.min(max_results || 8, 20));
    return { query, results };
  });

  // --- web_fetch ---
  // One page per call, no crawling: the agent itself is the crawler with
  // judgment — it sees the page's links and follows the relevant one with
  // another web_fetch, instead of this tool blindly fetching the first N
  // links (nav, footer, privacy policy...). agent.js truncates every tool
  // result at 12000 chars of JSON; 8000 text + up to 30 links fits.
  const TEXT_BUDGET = 8000;

  registry.register('web_fetch', {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch a URL and extract its text content and the links on the page. Use this to read articles, documentation, API responses, or any webpage. To follow a link, call web_fetch again with that URL — every fetched page lists its links.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
          selector: { type: 'string', description: 'CSS selector to extract specific content (optional)' },
        },
        required: ['url'],
      },
    },
  }, async ({ url, selector }) => {
    try {
      const { html, status, url: finalUrl } = await fetchPage(url);
      return {
        url: finalUrl,
        status,
        text: extractText(html, selector).slice(0, TEXT_BUDGET),
        links: extractLinks(html, finalUrl).slice(0, 30),
      };
    } catch (err) {
      return { url, error: err.message };
    }
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

    // Step 1: Search. The +4 (and the +3 below) is deliberate redundancy,
    // not a bug: some pages always fail (blocked, timeout, non-text), and
    // over-fetching in parallel keeps the report at sitesToVisit sources
    // without a serial re-fetch round. Results are still capped at
    // sitesToVisit — see the idx break in the report loop.
    const searchResults = await runSearch(query, sitesToVisit + 4);
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
