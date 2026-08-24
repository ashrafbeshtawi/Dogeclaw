# LLM prompt-cache efficiency audit

How well does DogeClaw target provider prompt caching to lower cost? Short answer:
**the prompt structure is already cache-friendly; the two real gaps are the
40-message sliding history window (which permanently kills the cache on long
sessions) and the fact that we throw away the `usage` data that would tell us
our actual hit rate.**

This document is the basis for that discussion. Everything below is grounded in
the current code with file references.

---

## 1. What one request looks like today

Every `Agent.run()` sends, in this order (`agent/src/agent.js:103`):

| # | Block | Source | Stability across turns |
|---|-------|--------|------------------------|
| 1 | System prompt: base prompt + workspace path + tool list + skills list + rules | `agent.js:20-59` | **Stable.** Tool registry order is insertion order; skills are `ORDER BY s.id` (`tools/skills.js:16`). Changes only when an admin edits agents/skills/models. |
| 2 | History: last 40 messages, user/assistant text only | `db/sessions.js:3,25-36` | Stable **until** the session exceeds 40 messages — then it shifts every turn (see §3.1). |
| 3 | New user message + `[Current date/time: …]` stamp at the tail | `agent.js:90-97`, `lib/timestamp.js` | New content; the stamp is deliberately **not persisted**, so history stays byte-stable. |
| 4 | (in-loop) assistant tool calls + tool results, appended, full array re-sent each iteration | `agent.js:129-172` | Append-only within the run. |

Persistence collapses the tool loop: only the final assistant text is stored as
a message; tool calls land in a metadata column that never goes back on the
wire (`web/server.js:216-221`, `channels/telegram.js:368-372`,
`cron/runner.js:178-181`; `llm.js:57-63` reads `m.tool_calls`, not the
persisted camelCase `toolCalls`). Media blobs are also not re-sent from
history — only `has_image`/`has_audio`/`has_video` flags survive.

## 2. How each of our providers caches

- **Ollama (local):** llama.cpp KV/prefix cache — an identical token prefix on
  the same slot skips prefill. Saves **latency**, not money. Prefix stability
  still matters (a shifted history means re-prefilling the whole context on
  every turn of a long session).
- **Google Gemini (direct):** implicit caching is on by default for 2.5-class
  models — no code needed, but it only triggers on a stable prefix above a
  minimum size (~1024 tokens Flash, ~2048 Pro). Hits are billed at a steep
  discount and reported in `usageMetadata.cachedContentTokenCount` — which we
  currently discard.
- **OpenRouter (passthrough):** depends on the underlying model. OpenAI models
  cache automatically (prefix ≥ 1024 tokens, discounted). Gemini models cache
  implicitly. **Anthropic models cache only with explicit `cache_control`
  breakpoints — we send none, so Anthropic-via-OpenRouter gets 0% caching
  today.** Cached-token counts are available via `usage: { include: true }`.

## 3. Scorecard

### Doing well (leave alone)

1. **Cache-optimal ordering.** Biggest stable block (system prompt) first,
   per-turn volatility (the timestamp) at the very tail of the newest message.
   Exactly what prefix caching wants.
2. **Timestamp never persisted.** Request N contains the stamp, but history
   stores the raw text, so old turns re-serialize identically. The divergence
   this causes sits at the tail of the previous user message — the tokens after
   it (last assistant reply, new message) could never have been cache hits
   anyway. Cost: ~zero.
3. **Append-only tool loop.** Each of up to 30 iterations re-sends the previous
   iteration's exact array plus new turns — every in-loop call after the first
   rides the cache. Tool-heavy runs are where most of our calls happen, so this
   is the volume case and it's already right.
4. **History collapse on persist.** Dropping tool turns (results are up to
   12,000 chars each, `agent.js:171`) keeps every future turn's input small.
   That's a raw token-cost win that dwarfs any caching consideration.
5. **Deterministic system prompt.** No randomness, no per-request IDs, ordered
   queries. A single admin edit invalidates the prefix once, which is fine.

### Losing the cache

1. **The 40-message sliding window (`sessions.js:3`) is the big one.** Once a
   session crosses 40 messages, every new turn drops the oldest message from the
   *front* of the history. The token prefix after the system prompt is
   different on every request from then on, so nothing past the system prompt
   ever hits cache again — for the rest of the session's life, and precisely in
   the longest (most expensive) sessions.
2. **No measurement.** All three adapters in `llm.js` discard the response
   `usage` block (`prompt_tokens`/`cached_tokens`, `cachedContentTokenCount`,
   `prompt_eval_count`). We cannot currently state our cache hit rate — this
   audit is static analysis, not telemetry.
3. **Anthropic via OpenRouter never caches** (no `cache_control`). Only worth
   fixing if anyone actually routes Anthropic models through OpenRouter —
   decide, don't assume.

### Context-size note (not caching, but adjacent)

Worst case in-flight: 30 iterations × 12,000-char tool results ≈ 360k chars
(~90k tokens) inside one run. Transient (never persisted), but it can blow the
context window of smaller local models mid-run. Worth keeping an eye on once
usage logging (below) exists.

## 4. Recommendations, cheapest first

1. **Log `usage` per LLM call** in the three adapters, and set
   `usage: { include: true }` for OpenRouter. ~10 lines. This turns the
   discussion from "we believe" into "we measured" and is a prerequisite for
   judging everything else.
2. **Trim history with hysteresis instead of a sliding window.** Keep up to
   ~60 messages and, when exceeded, cut back to 40 in one block (front-trim in
   steps of 20). The prefix then stays stable for ~10 turns between trims and
   each trim invalidates the cache once instead of perpetually. ~5 lines in
   `loadSession`.
3. **Optionally** add `cache_control` breakpoints (system prompt + last history
   message) on an Anthropic-only branch in the OpenRouter adapter — only if
   telemetry from (1) shows Anthropic traffic.
4. **Everything else: no change.** The structure is already right; adding
   explicit cache plumbing for Gemini/OpenAI/Ollama would be complexity with no
   payoff, since their caching is implicit and keyed purely on prefix
   stability.
