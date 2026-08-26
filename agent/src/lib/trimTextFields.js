// Trim long string values inside DB result rows so a result set keeps ALL
// its rows within the tool-result size cap, instead of the tail rows being
// cut off wholesale (which the model reads as "those rows don't exist").
// The marker tells the model the value continues — it can re-select fewer
// rows or specific columns to see more.
//
// ponytail: flat cap per string value; make it column-aware if a table ever
// needs full long values back through db_select.

const TEXT_FIELD_MAX = 500;

export function trimTextFields(rows, max = TEXT_FIELD_MAX) {
  if (!Array.isArray(rows)) return rows;
  return rows.map(row => {
    if (!row || typeof row !== 'object') return row;
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      out[k] = typeof v === 'string' && v.length > max
        ? `${v.slice(0, max)}…[+${v.length - max} chars]`
        : v;
    }
    return out;
  });
}
