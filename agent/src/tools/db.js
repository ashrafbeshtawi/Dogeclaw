import { agentQuery } from '../db/pool.js';
import { buildSelect, buildInsert, buildUpdate, buildDelete } from '../lib/sqlBuilder.js';
import { trimTextFields } from '../lib/trimTextFields.js';

// One flat tool per operation (db_tables, db_select, ...) instead of a single
// "database" tool with an operation enum — smaller models call simple flat
// schemas far more reliably than one nested multi-operation tool.

const READ_ONLY_NOTE = 'The agents, channels, models and skills tables are read-only.';

export function register(registry) {
  registry.register('db_tables', {
    type: 'function',
    function: {
      name: 'db_tables',
      description: 'List the tables in your PostgreSQL memory database with approximate row counts. Check this (and db_describe) before creating a new table — reuse existing tables. ' + READ_ONLY_NOTE,
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

  registry.register('db_describe', {
    type: 'function',
    function: {
      name: 'db_describe',
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

  registry.register('db_select', {
    type: 'function',
    function: {
      name: 'db_select',
      description: 'Read rows from a table. Example: {"table": "notes", "where": {"topic": "health"}, "order_by": "created_at DESC"}. Long text values are shown trimmed; select fewer rows or specific columns to see more of each.',
      parameters: {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Table name' },
          columns: { type: 'array', items: { type: 'string' }, description: 'Columns to return (default: all)' },
          where: { type: 'object', description: 'Filter as column → value, all ANDed equality' },
          order_by: { type: 'string', description: 'Column to sort by, optionally with DESC, e.g. "created_at DESC"' },
          limit: { type: 'number', description: 'Max rows (default 20, max 100)' },
        },
        required: ['table'],
      },
    },
  }, async ({ table, columns, where, order_by, limit }) => {
    const q = buildSelect({ table, columns, where, order_by, limit });
    const res = await agentQuery(q.text, q.params);
    return { rowCount: res.rowCount, rows: trimTextFields(res.rows) };
  });

  registry.register('db_insert', {
    type: 'function',
    function: {
      name: 'db_insert',
      description: 'Insert one row. Example: {"table": "notes", "values": {"topic": "health", "body": "..."}}. ' + READ_ONLY_NOTE,
      parameters: {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Table name' },
          values: { type: 'object', description: 'Column → value to insert' },
        },
        required: ['table', 'values'],
      },
    },
  }, async ({ table, values }) => {
    const q = buildInsert({ table, values });
    const res = await agentQuery(q.text, q.params);
    return { inserted: trimTextFields(res.rows)[0] };
  });

  registry.register('db_update', {
    type: 'function',
    function: {
      name: 'db_update',
      description: 'Update rows matching a filter. Example: {"table": "notes", "set": {"body": "..."}, "where": {"id": 3}}. ' + READ_ONLY_NOTE,
      parameters: {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Table name' },
          set: { type: 'object', description: 'Column → new value' },
          where: { type: 'object', description: 'Filter as column → value, all ANDed equality (required)' },
        },
        required: ['table', 'set', 'where'],
      },
    },
  }, async ({ table, set, where }) => {
    const q = buildUpdate({ table, set, where });
    const res = await agentQuery(q.text, q.params);
    return { updatedRows: res.rowCount };
  });

  registry.register('db_delete', {
    type: 'function',
    function: {
      name: 'db_delete',
      description: 'Delete rows matching a filter. Example: {"table": "notes", "where": {"id": 3}}. ' + READ_ONLY_NOTE,
      parameters: {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Table name' },
          where: { type: 'object', description: 'Filter as column → value, all ANDed equality (required)' },
        },
        required: ['table', 'where'],
      },
    },
  }, async ({ table, where }) => {
    const q = buildDelete({ table, where });
    const res = await agentQuery(q.text, q.params);
    return { deletedRows: res.rowCount };
  });

  registry.register('db_sql', {
    type: 'function',
    function: {
      name: 'db_sql',
      description: 'Run raw SQL — only for what the other db_ tools cannot do (JOINs, aggregates, CREATE TABLE, bulk changes). Example: {"query": "CREATE TABLE notes (id SERIAL PRIMARY KEY, topic TEXT, body TEXT, created_at TIMESTAMPTZ DEFAULT NOW())"}. ' + READ_ONLY_NOTE,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Raw SQL' },
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
