// Search providers + failover, dependency-free (global fetch only) so the
// stdlib-only unit stage can test everything with injected fakes. Engine
// rows come from the search_engines table (db/searchEngines.js).

export function mapGoogleResults(body) {
  return (body.items || []).map(item => ({
    title: item.title,
    url: item.link,
    snippet: (item.snippet || '').slice(0, 200),
  }));
}

export function mapBraveResults(body) {
  return (body.web?.results || []).map(item => ({
    title: item.title,
    url: item.url,
    snippet: (item.description || '').slice(0, 200),
  }));
}

// Google Custom Search JSON API — num caps at 10 per request.
export async function searchGoogle(query, limit, engine) {
  const url = 'https://www.googleapis.com/customsearch/v1'
    + `?key=${encodeURIComponent(engine.api_key)}&cx=${encodeURIComponent(engine.cx)}`
    + `&q=${encodeURIComponent(query)}&num=${Math.min(limit, 10)}`;
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Google search failed (${res.status}): ${body.error?.message || 'unknown error'}`);
  }
  return mapGoogleResults(body);
}

// Brave Search API — count caps at 20 per request.
export async function searchBrave(query, limit, engine) {
  const url = 'https://api.search.brave.com/res/v1/web/search'
    + `?q=${encodeURIComponent(query)}&count=${Math.min(limit, 20)}`;
  const res = await fetch(url, {
    headers: { 'X-Subscription-Token': engine.api_key, Accept: 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Brave search failed (${res.status}): ${body.error?.detail || body.message || 'unknown error'}`);
  }
  return mapBraveResults(body);
}

export const PROVIDERS = { google: searchGoogle, brave: searchBrave };

// Try the enabled engines in priority order; the first one that answers
// wins, a failing one just hands over to the next. Throws only when every
// engine failed (or none exist — callers gate tool visibility on that, so
// reaching this empty is a bug worth surfacing).
export async function runSearchWithFailover(engines, query, limit, providers = PROVIDERS) {
  // Own the ordering promised above instead of trusting the caller's array
  // order (rows without a priority sort as 0 — provider fakes in tests).
  const ordered = [...engines].sort(
    (a, b) => ((a.priority ?? 0) - (b.priority ?? 0)) || ((a.id ?? 0) - (b.id ?? 0)),
  );
  const errors = [];
  for (const engine of ordered) {
    const provider = providers[engine.provider];
    if (!provider) {
      errors.push(`${engine.provider}: unknown provider`);
      continue;
    }
    try {
      return await provider(query, limit, engine);
    } catch (err) {
      console.error(`[web] search via ${engine.provider} failed, trying next:`, err.message);
      errors.push(`${engine.provider}: ${err.message}`);
    }
  }
  throw new Error(`All search engines failed — ${errors.join('; ') || 'none configured'}`);
}

// Tool visibility gate: without an active engine the search tools are
// filtered out of the agent's tool view entirely.
export function hideSearchTools(entries, hasActiveEngine) {
  return hasActiveEngine ? entries : entries.filter(e => !e.meta?.requiresSearchEngine);
}
