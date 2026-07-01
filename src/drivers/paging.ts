// Wrap a SELECT/CTE as a subquery so LIMIT/OFFSET works for arbitrary user SQL.
// Non-SELECT statements (no result set to page) are passed through unchanged.
// `alias` lets engines that require a named derived table (MySQL) supply one.
//
// For WITH clauses we only wrap when the statement is a read-only CTE:
//   WITH ... SELECT  →  wrap
//   WITH ... INSERT / UPDATE / DELETE  →  pass through (DML-CTE, no result set)
export function applySelectPaging(
  sql: string,
  page: number,
  pageSize: number,
  alias = "_q",
): string {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  if (/^select/i.test(trimmed)) {
    return `select * from (${trimmed}) as ${alias} limit ${pageSize} offset ${page * pageSize}`;
  }
  if (/^with\b/i.test(trimmed)) {
    // Only wrap if the CTE body ends with a SELECT (read-only CTE).
    // A very lightweight check: scan for the last top-level keyword after the CTE defs.
    // We look for SELECT appearing after the balanced parentheses of the CTE.
    if (isReadOnlyCte(trimmed)) {
      return `select * from (${trimmed}) as ${alias} limit ${pageSize} offset ${page * pageSize}`;
    }
  }
  return sql;
}

// Returns true when a WITH statement's final clause is a SELECT (read CTE).
// Skips over nested parentheses to avoid matching SELECT inside the CTE body.
function isReadOnlyCte(sql: string): boolean {
  let depth = 0;
  let i = 0;
  const n = sql.length;
  // Skip past the WITH keyword itself.
  while (i < n && /\s/u.test(sql[i])) i++;
  if (sql.slice(i, i + 4).toLowerCase() !== "with") return false;
  i += 4;

  // Walk through the SQL tracking paren depth.
  // Once we're back at depth 0 after passing the initial WITH token,
  // the next keyword determines whether this is a SELECT or DML CTE.
  while (i < n) {
    const ch = sql[i];
    if (ch === "(") { depth++; i++; continue; }
    if (ch === ")") { depth--; i++; continue; }
    if (ch === "'" || ch === '"') {
      const q = ch; i++;
      while (i < n && sql[i] !== q) { if (sql[i] === "\\") i++; i++; }
      i++; continue;
    }
    if (depth === 0) {
      // Check for a keyword boundary at this position.
      const rest = sql.slice(i);
      if (/^select\b/i.test(rest)) return true;
      if (/^(insert|update|delete|merge)\b/i.test(rest)) return false;
    }
    i++;
  }
  // If we reach the end without a terminal keyword, treat as unknown → don't wrap.
  return false;
}
