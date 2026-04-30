import { agentQuery } from '../db/pool.js';

export function register(registry) {
  registry.register('query_database', {
    type: 'function',
    function: {
      name: 'query_database',
      description: 'Execute a SQL query against the PostgreSQL database. You have full read and write access: CREATE TABLE, INSERT, UPDATE, DELETE, SELECT. Use this to store and retrieve structured data. Examples: "CREATE TABLE notes (id SERIAL, title TEXT, body TEXT, created_at TIMESTAMPTZ DEFAULT NOW())", "INSERT INTO notes (title, body) VALUES ($1, $2)", "SELECT * FROM notes ORDER BY created_at DESC LIMIT 10", "UPDATE notes SET body = $1 WHERE id = $2". The agents, channels, and models tables are read-only.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'SQL query to execute' },
          params: {
            type: 'array',
            items: { type: 'string' },
            description: 'Query parameters (for $1, $2, etc.)',
          },
        },
        required: ['query'],
      },
    },
  }, async ({ query: sql, params }) => {
    const result = await agentQuery(sql, params || []);
    return {
      rowCount: result.rowCount,
      rows: result.rows?.slice(0, 100),
      command: result.command,
    };
  });
}
