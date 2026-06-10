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
  "select", "from", "where", "join", "left join", "inner join", "group by",
  "order by", "limit", "offset", "insert into", "update", "delete from",
  "values", "set", "and", "or", "not", "on", "as", "distinct", "having",
  "count", "sum", "avg", "min", "max",
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

  const out: Suggestion[] = [];
  for (const t of index.tables) {
    out.push({ kind: "table", label: t.name, detail: `table ${t.schema}.${t.name}` });
  }
  for (const k of KEYWORDS) out.push({ kind: "keyword", label: k });
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
