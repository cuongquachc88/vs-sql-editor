import * as vscode from "vscode";
import type { SchemaCache } from "../connections/schema-cache";
import type { ColumnMeta, SchemaModel } from "../drivers/types";

export interface SchemaIndex {
  tables: { name: string; schema: string }[];
  // key: lower-cased table name -> its columns
  columnsByTable: Map<string, ColumnMeta[]>;
}

export type Suggestion =
  | { kind: "table"; label: string; detail: string }
  | { kind: "column"; label: string; detail: string }
  | { kind: "keyword"; label: string };

const KEYWORDS = [
  // DML
  "select", "select distinct", "insert into", "update", "delete from",
  "values", "set", "returning", "on conflict", "on conflict do nothing",
  "on conflict do update set",
  // Clauses
  "from", "where", "having", "group by", "order by", "limit", "offset",
  "fetch next", "rows only",
  // Joins
  "join", "inner join", "left join", "left outer join", "right join",
  "right outer join", "full join", "full outer join", "cross join",
  "natural join", "on", "using",
  // Logical / comparison
  "and", "or", "not", "in", "not in", "exists", "not exists",
  "is null", "is not null", "is true", "is false",
  "between", "like", "ilike", "similar to",
  // CTEs & subqueries
  "with", "with recursive", "as",
  // Set operations
  "union", "union all", "intersect", "except",
  // Window functions
  "over", "partition by", "rows between", "range between",
  "unbounded preceding", "current row", "unbounded following",
  "row_number()", "rank()", "dense_rank()", "lag(", "lead(", "ntile(",
  "first_value(", "last_value(", "nth_value(",
  // Aggregate functions
  "count(", "count(*)", "sum(", "avg(", "min(", "max(",
  "string_agg(", "array_agg(", "json_agg(", "jsonb_agg(",
  "bool_and(", "bool_or(",
  // Scalar / string functions
  "coalesce(", "nullif(", "greatest(", "least(",
  "upper(", "lower(", "trim(", "ltrim(", "rtrim(",
  "length(", "char_length(", "substr(", "substring(",
  "replace(", "split_part(", "regexp_replace(", "regexp_match(",
  "concat(", "format(", "lpad(", "rpad(",
  // Numeric
  "round(", "floor(", "ceil(", "abs(", "mod(", "power(", "sqrt(",
  "random()", "generate_series(",
  // Date / time
  "now()", "current_timestamp", "current_date", "current_time",
  "date_trunc(", "date_part(", "extract(", "age(", "to_timestamp(",
  "to_char(", "interval",
  // JSON (Postgres)
  "jsonb_build_object(", "json_build_object(", "jsonb_extract_path(",
  "jsonb_array_elements(", "json_array_elements(",
  // Type casts
  "cast(", "::", "::text", "::int", "::bigint", "::numeric", "::boolean",
  "::timestamp", "::timestamptz", "::date", "::jsonb",
  // DDL
  "create table", "create table if not exists",
  "create index", "create unique index", "create view", "create schema",
  "alter table", "alter table add column", "alter table drop column",
  "alter table rename column", "alter table alter column",
  "drop table", "drop table if exists", "drop index", "drop view",
  "truncate", "truncate table",
  // Constraints
  "primary key", "not null", "unique", "default", "references",
  "foreign key", "check", "on delete cascade", "on delete set null",
  // Transactions
  "begin", "commit", "rollback", "savepoint", "release savepoint",
  // Explain
  "explain", "explain analyze", "explain (analyze, buffers)",
  // Misc
  "distinct on (", "filter (where", "case", "when", "then", "else", "end",
  "true", "false", "null",
];

export function buildIndex(model: SchemaModel): SchemaIndex {
  const tables: { name: string; schema: string }[] = [];
  const columnsByTable = new Map<string, ColumnMeta[]>();
  for (const db of model.databases) {
    for (const s of db.schemas) {
      for (const t of s.tables) {
        tables.push({ name: t.name, schema: s.name });
        columnsByTable.set(t.name.toLowerCase(), t.columns);
      }
    }
  }
  return { tables, columnsByTable };
}

// Map FROM/JOIN targets and their aliases to real table names.
// `from users u join orders as o` => { users->users, u->users, orders->orders, o->orders }
export function parseTableAliases(sql: string): Map<string, string> {
  const map = new Map<string, string>();
  const re =
    /\b(?:from|join)\s+([`"[]?\w+[`"\]]?(?:\.[`"[]?\w+[`"\]]?)?)\s*(?:\bas\b\s+)?([a-zA-Z_]\w*)?/gi;
  const stop = /^(where|on|inner|left|right|full|outer|join|group|order|limit|using|set|values)$/i;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const table = m[1].split(".").pop()!.replace(/[`"[\]]/g, "");
    map.set(table.toLowerCase(), table);
    const alias = m[2];
    if (alias && !stop.test(alias)) map.set(alias.toLowerCase(), table);
  }
  return map;
}

// Decide what to suggest given the text before the cursor on the current line.
export function computeCompletions(
  index: SchemaIndex,
  aliasMap: Map<string, string>,
  linePrefix: string,
): Suggestion[] {
  // 1. table.column — triggered by "."
  const dot = /([a-zA-Z_]\w*)\.\s*\w*$/.exec(linePrefix);
  if (dot) {
    const ref = dot[1].toLowerCase();
    const tableName = aliasMap.get(ref) ?? (index.columnsByTable.has(ref) ? ref : undefined);
    if (!tableName) return [];
    const cols = index.columnsByTable.get(tableName.toLowerCase()) ?? [];
    return cols.map((c) => ({
      kind: "column",
      label: c.name,
      detail: `${tableName}.${c.name} : ${c.type}`,
    }));
  }

  // 2. After FROM / JOIN — suggest tables only
  if (/\b(?:from|join)\s+\w*$/i.test(linePrefix)) {
    return index.tables.map((t) => ({
      kind: "table",
      label: t.name,
      detail: `table ${t.schema}.${t.name}`,
    }));
  }

  // 3. After SELECT / WHERE / SET / HAVING / ON — suggest columns + tables
  if (/\b(?:select|where|set|having|on)\b.*$/i.test(linePrefix)) {
    const out: Suggestion[] = [];
    // columns from all tables mentioned in the query so far
    for (const [, tableName] of aliasMap) {
      const cols = index.columnsByTable.get(tableName.toLowerCase()) ?? [];
      for (const c of cols) {
        out.push({ kind: "column", label: c.name, detail: `${tableName}.${c.name} : ${c.type}` });
      }
    }
    // fall back to all tables if no aliases parsed yet
    if (out.length === 0) {
      for (const t of index.tables) {
        out.push({ kind: "table", label: t.name, detail: `table ${t.schema}.${t.name}` });
      }
    }
    return out;
  }

  // 4. Default — keywords + tables
  const out: Suggestion[] = [];
  for (const k of KEYWORDS) out.push({ kind: "keyword", label: k });
  for (const t of index.tables) {
    out.push({ kind: "table", label: t.name, detail: `table ${t.schema}.${t.name}` });
  }
  return out;
}

function toItem(s: Suggestion): vscode.CompletionItem {
  if (s.kind === "keyword") {
    const item = new vscode.CompletionItem(s.label, vscode.CompletionItemKind.Keyword);
    return item;
  }
  if (s.kind === "table") {
    const item = new vscode.CompletionItem(s.label, vscode.CompletionItemKind.Struct);
    item.detail = s.detail;
    return item;
  }
  const item = new vscode.CompletionItem(s.label, vscode.CompletionItemKind.Field);
  item.detail = s.detail;
  return item;
}

// CompletionItemProvider for `.sql` files. Uses the cached schema for the active
// connection; if none is cached yet it warms the cache in the background and yields
// no suggestions for this keystroke (so typing is never blocked on introspection).
export function createSqlCompletionProvider(
  getActiveProfileId: () => string | undefined,
  schemaCache: SchemaCache,
): vscode.CompletionItemProvider {
  return {
    provideCompletionItems(document, position) {
      const profileId = getActiveProfileId();
      if (!profileId) return undefined;
      const model = schemaCache.peek(profileId);
      if (!model) {
        void schemaCache.get(profileId).catch(() => undefined);
        return undefined;
      }
      const index = buildIndex(model);
      const aliasMap = parseTableAliases(document.getText());
      const linePrefix = document.lineAt(position).text.slice(0, position.character);
      return computeCompletions(index, aliasMap, linePrefix).map(toItem);
    },
  };
}
