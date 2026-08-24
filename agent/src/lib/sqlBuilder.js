// Pure SQL builders for the database tool (src/tools/db.js): structured
// operations (select/insert/update/delete) compiled to parameterized SQL.
//
// Values always travel as $n parameters — never interpolated. Identifiers
// (table/column names) can't be parameterized in Postgres, so they're
// escaped with the double-quote rule (same semantics as pg's
// escapeIdentifier — implemented here so this module stays dependency-free
// for CI's npm-install-less unit stage, see agent/test/sqlBuilder.test.js).
//
// where/set are flat column → value objects, ANDed equality only. Anything
// fancier (operators, JOINs, aggregates) is the sql operation's job.

export function escapeIdent(name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`Invalid identifier: ${JSON.stringify(name)}`);
  }
  return `"${name.replace(/"/g, '""')}"`;
}

function whereClause(where, params) {
  const conds = Object.entries(where || {}).map(([col, val]) => {
    params.push(val);
    return `${escapeIdent(col)} = $${params.length}`;
  });
  return conds.length ? ` WHERE ${conds.join(' AND ')}` : '';
}

export function buildSelect({ table, columns, where, order_by, limit }) {
  const params = [];
  const cols = columns?.length ? columns.map(escapeIdent).join(', ') : '*';
  let text = `SELECT ${cols} FROM ${escapeIdent(table)}${whereClause(where, params)}`;
  if (order_by) {
    const [col, dir = '', ...rest] = order_by.trim().split(/\s+/);
    if (rest.length || !/^(asc|desc)?$/i.test(dir)) throw new Error(`Invalid order_by: ${order_by}`);
    text += ` ORDER BY ${escapeIdent(col)}${dir ? ` ${dir.toUpperCase()}` : ''}`;
  }
  params.push(Math.min(limit || 20, 100));
  return { text: `${text} LIMIT $${params.length}`, params };
}

export function buildInsert({ table, values }) {
  const entries = Object.entries(values || {});
  if (!entries.length) throw new Error('insert requires values');
  const cols = entries.map(([c]) => escapeIdent(c)).join(', ');
  const placeholders = entries.map((_, i) => `$${i + 1}`).join(', ');
  return {
    text: `INSERT INTO ${escapeIdent(table)} (${cols}) VALUES (${placeholders}) RETURNING *`,
    params: entries.map(([, v]) => v),
  };
}

export function buildUpdate({ table, set, where }) {
  const setEntries = Object.entries(set || {});
  if (!setEntries.length) throw new Error('update requires set');
  if (!Object.keys(where || {}).length) {
    throw new Error('update requires where — full-table updates must use the sql operation');
  }
  const params = [];
  const assignments = setEntries.map(([col, val]) => {
    params.push(val);
    return `${escapeIdent(col)} = $${params.length}`;
  }).join(', ');
  return { text: `UPDATE ${escapeIdent(table)} SET ${assignments}${whereClause(where, params)}`, params };
}

export function buildDelete({ table, where }) {
  if (!Object.keys(where || {}).length) {
    throw new Error('delete requires where — full-table deletes must use the sql operation');
  }
  const params = [];
  return { text: `DELETE FROM ${escapeIdent(table)}${whereClause(where, params)}`, params };
}
