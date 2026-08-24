import { adminQuery } from '../db/pool.js';

export function register(registry) {
  registry.register('search_history', {
    type: 'function',
    function: {
      name: 'search_history',
      description: 'Search the full stored history of THIS conversation for a keyword or phrase. Your visible context only contains recent messages — use this to recall older facts, decisions, or details from earlier in the conversation. Example: search_history({"query": "birthday"}).',
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
    const res = await adminQuery(
      `SELECT role, content, created_at
         FROM session_messages
        WHERE session_id = $1 AND content ILIKE '%' || $2 || '%'
        ORDER BY id DESC
        LIMIT $3`,
      [context.sessionId, query, Math.min(limit || 10, 20)],
    );
    return {
      matches: res.rows.map(r => ({
        role: r.role,
        at: r.created_at,
        content: String(r.content).slice(0, 500),
      })),
    };
  });
}
