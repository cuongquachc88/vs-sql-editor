// Pure helpers for building UPDATE statements from inline grid edits.
// Identifier quoting differs per engine (passed in); value formatting is shared.

export type QuoteId = (id: string) => string;

export const quoteDoubleQuote: QuoteId = (id) => `"${id.replace(/"/g, '""')}"`;
export const quoteBacktick: QuoteId = (id) => `\`${id.replace(/`/g, "``")}\``;

// Render a JS value as a SQL literal. Conservative and engine-agnostic:
// single quotes doubled for strings; numbers/bools/null passed through.
export function formatLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replace(/'/g, "''")}'`;
}

// Build `update <table> set ... where <pk...>`. `table` must already be the
// qualified/quoted reference (e.g. "public"."users"). Throws if there is nothing
// to change or no primary key to target (a row-identifying WHERE is required).
export function buildUpdate(
  quoteId: QuoteId,
  table: string,
  pk: Record<string, unknown>,
  changes: Record<string, unknown>,
): string {
  const changeEntries = Object.entries(changes);
  const pkEntries = Object.entries(pk);
  if (changeEntries.length === 0) throw new Error("No changes to apply");
  if (pkEntries.length === 0) throw new Error("No primary key to identify the row");

  const setClause = changeEntries
    .map(([col, val]) => `${quoteId(col)} = ${formatLiteral(val)}`)
    .join(", ");
  const whereClause = pkEntries
    .map(([col, val]) => `${quoteId(col)} = ${formatLiteral(val)}`)
    .join(" and ");

  return `update ${table} set ${setClause} where ${whereClause}`;
}
