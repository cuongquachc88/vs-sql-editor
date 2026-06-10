import type { ColumnMeta, SchemaModel, TableInfo } from "./types";

// Row shape returned by the columns query below.
interface ColRow {
  table_schema: string;
  table_name: string;
  table_type: string;
  column_name: string;
  data_type: string;
}
interface PkRow {
  table_schema: string;
  table_name: string;
  column_name: string;
}

const COLUMNS_SQL = `
  select c.table_schema, c.table_name, t.table_type,
         c.column_name, c.data_type
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema not in ('pg_catalog', 'information_schema')
  order by c.table_schema, c.table_name, c.ordinal_position`;

const PK_SQL = `
  select tc.table_schema, tc.table_name, kcu.column_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on kcu.constraint_name = tc.constraint_name
   and kcu.table_schema = tc.table_schema
  where tc.constraint_type = 'PRIMARY KEY'`;

// Shared introspection for Postgres-protocol engines (Postgres + PGlite).
// `runObjects` runs a SQL string and returns rows as plain objects.
export async function introspectPostgresLike(
  runObjects: (sql: string) => Promise<Record<string, unknown>[]>,
  databaseName: string,
): Promise<SchemaModel> {
  const [colRows, pkRows] = await Promise.all([
    runObjects(COLUMNS_SQL) as Promise<unknown[]>,
    runObjects(PK_SQL) as Promise<unknown[]>,
  ]);

  const pkByTable = new Map<string, string[]>();
  for (const r of pkRows as PkRow[]) {
    const key = `${r.table_schema}.${r.table_name}`;
    const list = pkByTable.get(key) ?? [];
    list.push(r.column_name);
    pkByTable.set(key, list);
  }

  // schema -> table -> TableInfo
  const schemas = new Map<string, Map<string, TableInfo>>();
  for (const r of colRows as ColRow[]) {
    const schemaTables = schemas.get(r.table_schema) ?? new Map<string, TableInfo>();
    schemas.set(r.table_schema, schemaTables);
    const table =
      schemaTables.get(r.table_name) ??
      ({
        name: r.table_name,
        isView: /view/i.test(r.table_type),
        columns: [] as ColumnMeta[],
        primaryKey: pkByTable.get(`${r.table_schema}.${r.table_name}`) ?? [],
      } satisfies TableInfo);
    schemaTables.set(r.table_name, table);
    table.columns.push({ name: r.column_name, type: r.data_type });
  }

  return {
    databases: [
      {
        name: databaseName,
        schemas: [...schemas.entries()]
          .map(([name, tableMap]) => ({ name, tables: [...tableMap.values()] }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      },
    ],
  };
}
