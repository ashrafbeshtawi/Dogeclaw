import { agentQuery } from '../db/pool.js';
import { trimTextFields } from '../lib/trimTextFields.js';

// Three tools: two for schema discovery, one for everything else. The model
// writes plain SQL for reads and writes — earlier per-operation wrappers
// (db_select/insert/update/delete) just re-invented a worse SQL in JSON.

const READ_ONLY_NOTE = 'The agents, channels, models and skills tables are read-only.';

export function register(registry) {
  registry.register('db_list_tables', {
    type: 'function',
    function: {
      name: 'db_list_tables',
      description: 'List the tables in your PostgreSQL memory database with approximate row counts. Check this (and db_describe_table) before creating a new table — reuse existing tables. ' + READ_ONLY_NOTE,
      parameters: { type: 'object', properties: {} },
    },
  }, async () => {
    // Only tables the agent role itself created: DogeClaw's own
    // infrastructure tables are owned by the admin role and stay hidden.
    // reltuples is the planner's estimate (-1 = never analyzed → 0).
    const res = await agentQuery(
      `SELECT c.relname AS table_name,
              GREATEST(c.reltuples, 0)::bigint AS approx_rows
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND pg_get_userbyid(c.relowner) = current_user
        ORDER BY c.relname`,
    );
    return { tables: res.rows };
  });

  registry.register('db_describe_table', {
    type: 'function',
    function: {
      name: 'db_describe_table',
      description: 'Show a table\'s columns, types and primary key.',
      parameters: {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Table name' },
        },
        required: ['table'],
      },
    },
  }, async ({ table }) => {
    const cols = await agentQuery(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position`,
      [table],
    );
    if (!cols.rowCount) return { error: `Table not found: ${table}` };
    const pk = await agentQuery(
      `SELECT a.attname
         FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = $1::regclass AND i.indisprimary`,
      [table],
    );
    return {
      columns: cols.rows.map(c => ({
        name: c.column_name,
        type: c.data_type,
        nullable: c.is_nullable === 'YES',
        default: c.column_default,
      })),
      primaryKey: pk.rows.map(r => r.attname),
    };
  });

  registry.register('db_run_sql', {
    type: 'function',
    function: {
      name: 'db_run_sql',
      description: 'Run SQL against your PostgreSQL memory database — SELECT, INSERT, UPDATE, DELETE, CREATE TABLE, JOINs, aggregates. Use params ($1, $2) for values. Examples: {"query": "SELECT * FROM notes WHERE topic = $1 ORDER BY created_at DESC LIMIT 20", "params": ["health"]} or {"query": "INSERT INTO notes (topic, body) VALUES ($1, $2)", "params": ["health", "..."]}. Long text values in results are shown trimmed. ' + READ_ONLY_NOTE,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'SQL to run' },
          params: { type: 'array', items: { type: 'string' }, description: 'Parameters for $1, $2 in the SQL' },
        },
        required: ['query'],
      },
    },
  }, async ({ query: sql, params }) => {
    const res = await agentQuery(sql, params || []);
    return {
      rowCount: res.rowCount,
      rows: trimTextFields(res.rows?.slice(0, 100)),
      command: res.command,
      ...(res.rows?.length > 100 && { truncated: true }),
    };
  });
}
