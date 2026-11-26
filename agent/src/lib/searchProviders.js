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

// Per-request budget for a search provider. Without it a provider that
// accepts the connection but stalls holds the call open for Node's ~300s
// default, so failover never reaches the next engine and the chat's session
// lock stays held the whole time.
export const SEARCH_TIMEOUT_MS = 10000;

const isAbort = err => err?.name === 'TimeoutError' || err?.name === 'AbortError';

// fetch + JSON body read under one abort deadline (covers a stall before the
// headers and mid-body). A timeout surfaces as a normal Error so the failover
// loop treats it like any other provider failure; a non-JSON body still
// degrades to {} as before.
async function fetchJsonWithTimeout(label, url, init, timeoutMs) {
  const signal = AbortSignal.timeout(timeoutMs);
  const timedOut = () => new Error(`${label} search timed out after ${timeoutMs}ms`);
  let res;
  try {
    res = await fetch(url, { ...init, signal });
  } catch (err) {
    throw isAbort(err) ? timedOut() : err;
  }
  let body;
  try {
    body = await res.json();
  } catch (err) {
    if (isAbort(err) || signal.aborted) throw timedOut();
    body = {};
  }
  return { res, body };
}

// Google Custom Search JSON API — num caps at 10 per request.
export async function searchGoogle(query, limit, engine, { timeoutMs = SEARCH_TIMEOUT_MS } = {}) {
  const url = 'https://www.googleapis.com/customsearch/v1'
    + `?key=${encodeURIComponent(engine.api_key)}&cx=${encodeURIComponent(engine.cx)}`
    + `&q=${encodeURIComponent(query)}&num=${Math.min(limit, 10)}`;
  const { res, body } = await fetchJsonWithTimeout('Google', url, {}, timeoutMs);
  if (!res.ok) {
    throw new Error(`Google search failed (${res.status}): ${body.error?.message || 'unknown error'}`);
  }
  return mapGoogleResults(body);
}

// Brave Search API — count caps at 20 per request.
export async function searchBrave(query, limit, engine, { timeoutMs = SEARCH_TIMEOUT_MS } = {}) {
  const url = 'https://api.search.brave.com/res/v1/web/search'
    + `?q=${encodeURIComponent(query)}&count=${Math.min(limit, 20)}`;
  const { res, body } = await fetchJsonWithTimeout('Brave', url, {
    headers: { 'X-Subscription-Token': engine.api_key, Accept: 'application/json' },
  }, timeoutMs);
  if (!res.ok) {
    throw new Error(`Brave search failed (${res.status}): ${body.error?.detail || body.message || 'unknown error'}`);
  }
  return mapBraveResults(body);
}

export const PROVIDERS = { google: searchGoogle, brave: searchBrave };

// Try the enabled engines in priority order; the first one that answers
// wins, a failing one just hands over to the next. Throws only when every
// engine failed (or none exist — callers gate tool visibility on that, so
// reaching this empty is a bug worth surfacing). `options` (e.g. timeoutMs)
// is forwarded to every provider call.
export async function runSearchWithFailover(engines, query, limit, providers = PROVIDERS, options = {}) {
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
      return await provider(query, limit, engine, options);
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
