import { fetchPage } from '../lib/fetchPage.js';
import { extractText, extractLinks } from '../lib/webExtract.js';
import { runSearchWithFailover } from '../lib/searchProviders.js';
import { listActiveEngines } from '../db/searchEngines.js';

// Engines come from the search_engines table (admin UI → Search tab),
// tried in priority order with automatic failover. The registration meta
// requiresSearchEngine makes agent.js hide the search tools entirely while
// no enabled engine exists — so this only runs with at least one engine.
async function runSearch(query, limit) {
  const engines = await listActiveEngines();
  return runSearchWithFailover(engines, query, limit);
}

// Tools that need a configured search engine carry this meta.
const NEEDS_SEARCH = { requiresSearchEngine: true };

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
  }, NEEDS_SEARCH);

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
}
