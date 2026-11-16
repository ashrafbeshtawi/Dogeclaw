import { agentQuery, AGENT_STATEMENT_TIMEOUT_MS } from '../db/pool.js';
import { trimTextFields } from '../lib/trimTextFields.js';

// Three tools: two for schema discovery, one for everything else. The model
// writes plain SQL for reads and writes — earlier per-operation wrappers
// (db_select/insert/update/delete) just re-invented a worse SQL in JSON.

export function register(registry) {
  registry.register('db_list_tables', {
    type: 'function',
    function: {
      name: 'db_list_tables',
      description: 'List the tables in your PostgreSQL memory database with approximate row counts. Check this (and db_describe_table) before creating a new table — reuse existing tables.',
      parameters: { type: 'object', properties: {} },
    },
  }, async () => {
    // Only tables the agent role itself created in public.
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
      description: 'Run SQL against your PostgreSQL memory database — SELECT, INSERT, UPDATE, DELETE, CREATE TABLE, JOINs, aggregates. Use params ($1, $2) for values. Examples: {"query": "SELECT * FROM notes WHERE topic = $1 ORDER BY created_at DESC LIMIT 20", "params": ["health"]} or {"query": "INSERT INTO notes (topic, body) VALUES ($1, $2)", "params": ["health", "..."]}. Long text values in results are shown trimmed. At most 100 rows are returned (truncated: true when there are more); queries are cancelled after 30 seconds.',
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
    let res;
    try {
      res = await runCapped(sql, params || []);
    } catch (err) {
      if (err.code === QUERY_CANCELED) {
        return { error: `Query cancelled after ${AGENT_STATEMENT_TIMEOUT_MS / 1000}s. Add a LIMIT, narrow the WHERE or add an index.` };
      }
      throw err;
    }
    const truncated = res.rows?.length > MAX_ROWS;
    return {
      // Reads are capped at the source, so a truncated count is not the total.
      rowCount: truncated ? MAX_ROWS : res.rowCount,
      rows: trimTextFields(res.rows?.slice(0, MAX_ROWS)),
      command: res.command,
      ...(truncated && { truncated: true }),
    };
  });
}

export const MAX_ROWS = 100;
const QUERY_CANCELED = '57014';
// Errors Postgres raises while parsing the wrapped query (e.g. a data-modifying
// CTE inside a subquery). Nothing has run yet, so the plain query is safe to try.
const WRAP_PARSE_ERRORS = new Set(['42601', '0A000']);

/**
 * Run agent SQL, fetching at most MAX_ROWS + 1 rows for reads. pg loads the
 * whole result into memory, so the cap has to be in the query itself: a
 * SELECT/WITH is wrapped as a subquery with a LIMIT. Anything the wrap can't
 * handle runs as written.
 */
export async function runCapped(sql, params) {
  const body = sql.trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(body) || body.includes(';')) {
    return agentQuery(sql, params);
  }
  try {
    // The newline keeps a trailing `-- comment` from swallowing the `)`.
    return await agentQuery(`SELECT * FROM (${body}\n) AS _q LIMIT ${MAX_ROWS + 1}`, params);
  } catch (err) {
    if (WRAP_PARSE_ERRORS.has(err.code)) return agentQuery(sql, params);
    throw err;
  }
}
