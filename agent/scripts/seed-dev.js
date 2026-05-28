// Dev fixtures loader.
//
// Idempotently populates a fresh DogeClaw stack with a small starter set so
// the admin UI isn't empty on first boot. Safe to re-run — every insert
// hooks into the unique constraint on `name`, so existing fixtures are
// left alone.
//
// Run from inside the container:
//   docker exec dogeclaw npm run seed
//
// Reads from env (see .env.example):
//   DOGECLAW_FIXTURE_OPENROUTER_API_KEY  — required to seed the model
//   DOGECLAW_FIXTURE_TELEGRAM_BOT_TOKEN  — required to seed the telegram channel
//
// Missing env vars skip that piece with a warning rather than failing.

import { adminQuery, shutdown } from '../src/db/pool.js';

const env = process.env;
const OPENROUTER_KEY = env.DOGECLAW_FIXTURE_OPENROUTER_API_KEY || '';
const TG_TOKEN       = env.DOGECLAW_FIXTURE_TELEGRAM_BOT_TOKEN || '';

// Display name and OpenRouter model id. Operators can change OR_MODEL_ID
// without touching anything else — DeepSeek's catalog moves fast.
const MODEL_NAME    = 'deepseek-v4-pro';
const OR_MODEL_ID   = 'deepseek/deepseek-v4-pro';
const TG_CHANNEL_NAME = 'fixture-telegram';

const SKILLS = [
  {
    name: 'web-research',
    description: 'Search the web and synthesize findings from multiple sources.',
    content: [
      'When asked to research a topic:',
      '1. Use web_search to find relevant URLs.',
      '2. Use web_fetch on the most promising results to read full content.',
      '3. Cross-check across sources and call out contradictions.',
      '4. Cite the URLs that backed each claim.',
    ].join('\n'),
  },
  {
    name: 'summarizer',
    description: 'Produce tight, faithful summaries of long inputs.',
    content: [
      'Summaries should:',
      '- Lead with the single most important point.',
      '- Preserve names, numbers, and dates verbatim.',
      '- Note explicitly when the source disagrees with itself.',
      '- Never invent facts the source did not state.',
    ].join('\n'),
  },
  {
    name: 'python-dev',
    description: 'Idiomatic Python with a bias toward stdlib and readability.',
    content: [
      'Prefer stdlib over third-party deps when the gap is small.',
      'Use type hints on public functions; keep them off trivial locals.',
      'Avoid premature abstraction — three concrete examples before extracting a helper.',
      'Tests sit next to the code under `tests/` mirroring the package layout.',
    ].join('\n'),
  },
];

const AGENTS = [
  {
    name: 'assistant',
    system_prompt: 'You are a helpful, concise assistant. Prefer action over asking; chain tools to answer fully.',
    skills: [],
  },
  {
    name: 'researcher',
    system_prompt: 'You research questions by searching the web and synthesizing across multiple sources. Always cite the URLs you used.',
    skills: ['web-research', 'summarizer'],
  },
  {
    name: 'python-helper',
    system_prompt: 'You help with Python code. Be direct, show small runnable examples, and prefer stdlib.',
    skills: ['python-dev'],
  },
];

async function seedModel() {
  if (!OPENROUTER_KEY) {
    console.log('[seed] skipped model — set DOGECLAW_FIXTURE_OPENROUTER_API_KEY to seed DeepSeek via OpenRouter');
    return null;
  }
  const res = await adminQuery(
    `INSERT INTO models (name, provider, base_url, model_id, api_key, think, accepts)
     VALUES ($1, 'openrouter', 'https://openrouter.ai', $2, $3, false, '["text"]'::jsonb)
     ON CONFLICT (name) DO UPDATE SET
       provider = EXCLUDED.provider,
       base_url = EXCLUDED.base_url,
       model_id = EXCLUDED.model_id,
       api_key  = EXCLUDED.api_key,
       accepts  = EXCLUDED.accepts
     RETURNING id, (xmax = 0) AS inserted`,
    [MODEL_NAME, OR_MODEL_ID, OPENROUTER_KEY],
  );
  const row = res.rows[0];
  console.log(`[seed] model "${MODEL_NAME}" (${OR_MODEL_ID}) ${row.inserted ? 'created' : 'updated'} (id=${row.id})`);
  return row.id;
}

async function seedSkills() {
  const ids = {};
  for (const s of SKILLS) {
    const res = await adminQuery(
      `INSERT INTO skills (name, description, content)
       VALUES ($1, $2, $3)
       ON CONFLICT (name) DO NOTHING
       RETURNING id`,
      [s.name, s.description, s.content],
    );
    if (res.rowCount > 0) {
      ids[s.name] = res.rows[0].id;
      console.log(`[seed] skill "${s.name}" created (id=${ids[s.name]})`);
    } else {
      const existing = await adminQuery('SELECT id FROM skills WHERE name = $1', [s.name]);
      ids[s.name] = existing.rows[0].id;
      console.log(`[seed] skill "${s.name}" already exists (id=${ids[s.name]})`);
    }
  }
  return ids;
}

async function seedAgents(modelId, skillIds) {
  const ids = {};
  for (const a of AGENTS) {
    const res = await adminQuery(
      `INSERT INTO agents (name, system_prompt, model_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE SET model_id = COALESCE(EXCLUDED.model_id, agents.model_id)
       RETURNING id, (xmax = 0) AS inserted`,
      [a.name, a.system_prompt, modelId],
    );
    const row = res.rows[0];
    ids[a.name] = row.id;
    console.log(`[seed] agent "${a.name}" ${row.inserted ? 'created' : 'updated'} (id=${row.id})`);

    // Re-link skills idempotently. Insert ignore on the composite PK is enough.
    for (const skillName of a.skills) {
      const skillId = skillIds[skillName];
      if (!skillId) continue;
      await adminQuery(
        `INSERT INTO agent_skills (agent_id, skill_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [row.id, skillId],
      );
    }
  }
  return ids;
}

async function seedTelegramChannel(agentIds) {
  if (!TG_TOKEN) {
    console.log('[seed] skipped telegram channel — set DOGECLAW_FIXTURE_TELEGRAM_BOT_TOKEN to seed it');
    return;
  }
  const assistantId = agentIds.assistant;
  if (!assistantId) {
    console.warn('[seed] no "assistant" agent found, cannot create telegram channel');
    return;
  }

  // Channels have no unique constraint on name, so we check first.
  const existing = await adminQuery(
    `SELECT id FROM channels WHERE type = 'telegram' AND name = $1`,
    [TG_CHANNEL_NAME],
  );
  if (existing.rowCount > 0) {
    await adminQuery(
      `UPDATE channels SET config = jsonb_set(config, '{token}', to_jsonb($1::text)), agent_id = $2
       WHERE id = $3`,
      [TG_TOKEN, assistantId, existing.rows[0].id],
    );
    console.log(`[seed] telegram channel "${TG_CHANNEL_NAME}" updated (id=${existing.rows[0].id})`);
    return;
  }

  const res = await adminQuery(
    `INSERT INTO channels (agent_id, type, name, config, response_mode, enabled)
     VALUES ($1, 'telegram', $2, $3::jsonb, 'immediate', true)
     RETURNING id`,
    [assistantId, TG_CHANNEL_NAME, JSON.stringify({ token: TG_TOKEN })],
  );
  console.log(`[seed] telegram channel "${TG_CHANNEL_NAME}" created (id=${res.rows[0].id})`);
}

async function main() {
  console.log('[seed] starting dev fixture load...');
  const modelId = await seedModel();
  const skillIds = await seedSkills();
  const agentIds = await seedAgents(modelId, skillIds);
  await seedTelegramChannel(agentIds);
  console.log('[seed] done.');
}

main()
  .catch(err => {
    console.error('[seed] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => shutdown());
