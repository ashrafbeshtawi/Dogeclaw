import { agentQuery } from '../db/pool.js';
import { buildSelect, buildInsert, buildUpdate, buildDelete } from '../lib/sqlBuilder.js';

export function register(registry) {
  registry.register('database', {
    type: 'function',
    function: {
      name: 'database',
      description: 'Your PostgreSQL database for storing and retrieving structured data — use it to remember facts and look them up. Prefer the structured operations: "tables" lists your tables, "describe" shows a table\'s columns and primary key, "select"/"insert"/"update"/"delete" cover row operations without writing SQL. Use "sql" only for what they cannot do (JOINs, aggregates, CREATE TABLE, bulk changes). Examples: {"operation": "tables"}, {"operation": "select", "table": "notes", "where": {"topic": "health"}}, {"operation": "insert", "table": "notes", "values": {"topic": "health", "body": "..."}}. The agents, channels, models and skills tables are read-only.',
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['tables', 'describe', 'select', 'insert', 'update', 'delete', 'sql'], description: 'The operation to perform' },
          table: { type: 'string', description: 'Table name (describe/select/insert/update/delete)' },
          columns: { type: 'array', items: { type: 'string' }, description: 'Columns to return for select (default: all)' },
          where: { type: 'object', description: 'Filter as column → value, all ANDed equality (select; required for update/delete)' },
          values: { type: 'object', description: 'Column → value to insert (insert)' },
          set: { type: 'object', description: 'Column → new value (update)' },
          order_by: { type: 'string', description: 'Column to sort select results by, optionally with DESC, e.g. "created_at DESC"' },
          limit: { type: 'number', description: 'Max rows for select (default 20, max 100)' },
          query: { type: 'string', description: 'Raw SQL (sql operation only), e.g. "CREATE TABLE notes (id SERIAL PRIMARY KEY, topic TEXT, body TEXT, created_at TIMESTAMPTZ DEFAULT NOW())"' },
          params: { type: 'array', items: { type: 'string' }, description: 'Parameters for $1, $2 in raw SQL' },
        },
        required: ['operation'],
      },
    },
  }, async ({ operation, table, columns, where, values, set, order_by, limit, query: sql, params }) => {
    switch (operation) {
      case 'tables': {
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
      }
      case 'describe': {
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
      }
      case 'select': {
        const q = buildSelect({ table, columns, where, order_by, limit });
        const res = await agentQuery(q.text, q.params);
        return { rowCount: res.rowCount, rows: res.rows };
      }
      case 'insert': {
        const q = buildInsert({ table, values });
        const res = await agentQuery(q.text, q.params);
        return { inserted: res.rows[0] };
      }
      case 'update': {
        const q = buildUpdate({ table, set, where });
        const res = await agentQuery(q.text, q.params);
        return { updatedRows: res.rowCount };
      }
      case 'delete': {
        const q = buildDelete({ table, where });
        const res = await agentQuery(q.text, q.params);
        return { deletedRows: res.rowCount };
      }
      case 'sql': {
        if (!sql) return { error: 'query is required for the sql operation' };
        const res = await agentQuery(sql, params || []);
        return {
          rowCount: res.rowCount,
          rows: res.rows?.slice(0, 100),
          command: res.command,
          ...(res.rows?.length > 100 && { truncated: true }),
        };
      }
      default:
        return { error: `Unknown operation: ${operation}` };
    }
  });
}
