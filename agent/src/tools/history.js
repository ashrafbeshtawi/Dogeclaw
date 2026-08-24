import { adminQuery } from '../db/pool.js';

// Messages of surrounding conversation returned before/after each match —
// a bare matching line ("Noted!") is useless without what was said around it.
const CONTEXT = 2;

export function register(registry) {
  registry.register('search_history', {
    type: 'function',
    function: {
      name: 'search_history',
      description: 'Search the full stored history of THIS conversation for a keyword or phrase. Your visible context only contains recent messages — use this to recall older facts, decisions, or details from earlier in the conversation. Returns each match plus the surrounding messages, in chronological order; actual matches are flagged with match:true, and a jump in seq means a gap between two match windows. Example: search_history({"query": "birthday"}).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to search for (case-insensitive substring match)' },
          limit: { type: 'number', description: 'Max matches to return, newest first (default 10, max 20)' },
        },
        required: ['query'],
      },
    },
  }, async ({ query, limit }, context = {}) => {
    if (!query) return { error: 'query is required' };
    if (!context.sessionId) return { error: 'no session in calling context' };
    // Neighbors are found by per-session row number, not id — ids are global
    // across sessions, so id±N would skip over other sessions' messages.
    // Overlapping windows dedupe via DISTINCT on the row number.
    const res = await adminQuery(
      `WITH numbered AS (
         SELECT id, role, content, created_at,
                ROW_NUMBER() OVER (ORDER BY id) AS rn
           FROM session_messages
          WHERE session_id = $1
       ),
       hits AS (
         SELECT rn FROM numbered
          WHERE content ILIKE '%' || $2 || '%'
          ORDER BY rn DESC
          LIMIT $3
       )
       SELECT DISTINCT n.rn, n.role, n.content, n.created_at,
              n.content ILIKE '%' || $2 || '%' AS is_match
         FROM numbered n
         JOIN hits h ON n.rn BETWEEN h.rn - $4 AND h.rn + $4
        ORDER BY n.rn`,
      [context.sessionId, query, Math.min(limit || 10, 20), CONTEXT],
    );
    return {
      matches: res.rows.map(r => ({
        seq: Number(r.rn),
        role: r.role,
        at: r.created_at,
        content: String(r.content).slice(0, 500),
        ...(r.is_match && { match: true }),
      })),
    };
  });
}
