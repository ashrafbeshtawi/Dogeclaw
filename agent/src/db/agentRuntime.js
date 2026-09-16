import { adminQuery } from './pool.js';

// What an agent needs in order to run: who it is, and which model to call.
//
// This used to be assembled at every entry point — the web chat, the cron
// runner, and both Telegram paths — each repeating the join, the column list
// and the defaults. The copies drifted (one aliased the model identifier as
// `ollama_model`, the rest called it `model_id`) and, worse, a field could be
// threaded through all of them and consumed by none: the per-model `think`
// toggle reached every caller correctly and was read only by the Ollama
// provider, so enabling thinking on an OpenRouter model did nothing.
//
// Admin pool throughout: this reads models.api_key, and V18 revoked SELECT on
// `models` from the restricted role precisely so the agent's SQL tool cannot
// read its own credentials. Callers here are trusted server code.

// `a.*` would collide with the model's identifier — agents.model_id is the FK,
// models.model_id is the name the provider knows ("gemma3:1b") — which is why
// the old code aliased one of them. Selecting explicitly avoids the clash
// instead of papering over it.
const RUNTIME_COLUMNS = `
  a.id AS agent_id, a.name AS agent_name, a.system_prompt,
  m.base_url, m.model_id, m.think, m.accepts, m.provider, m.api_key`;

/**
 * Builds the model half of the runtime config from any row carrying the model
 * columns — an agent join here, or a channel join in the Telegram manager,
 * which is what lets a channel override the model at runtime.
 *
 * Returns null when the agent has no model assigned, which every caller
 * already treats as "not runnable".
 *
 * This is the single place the provider and accepts defaults are applied.
 */
export function toModelConfig(row) {
  if (!row?.model_id) return null;
  return {
    base_url: row.base_url,
    model_id: row.model_id,
    think: row.think,
    accepts: row.accepts || ['text'],
    provider: row.provider || 'ollama',
    apiKey: row.api_key,
  };
}

/** Returns { agent, modelConfig } for an agent id, or null if no such agent. */
export async function loadAgentRuntime(agentId) {
  const res = await adminQuery(
    `SELECT ${RUNTIME_COLUMNS}
       FROM agents a LEFT JOIN models m ON a.model_id = m.id
      WHERE a.id = $1`,
    [agentId],
  );
  const row = res.rows[0];
  if (!row) return null;
  // snake_case to match how every caller already reads these rows.
  return {
    agent: { id: row.agent_id, name: row.agent_name, system_prompt: row.system_prompt },
    modelConfig: toModelConfig(row),
  };
}
