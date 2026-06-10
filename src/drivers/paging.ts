// Wrap a SELECT/CTE as a subquery so LIMIT/OFFSET works for arbitrary user SQL.
// Non-SELECT statements (no result set to page) are passed through unchanged.
// `alias` lets engines that require a named derived table (MySQL) supply one.
export function applySelectPaging(
  sql: string,
  page: number,
  pageSize: number,
  alias = "_q",
): string {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  if (!/^select|^with/i.test(trimmed)) return sql;
  return `select * from (${trimmed}) as ${alias} limit ${pageSize} offset ${page * pageSize}`;
}
