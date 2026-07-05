import type {
  ColumnMeta,
  ForeignKey,
  FunctionInfo,
  SchemaModel,
  TableInfo,
} from "./types";

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
interface FkRow {
  constraint_name: string;
  table_schema: string;
  table_name: string;
  column_name: string;
  ref_schema: string;
  ref_table: string;
  ref_column: string;
  ordinal_position: number;
}

const COLUMNS_SQL = `
  select c.table_schema, c.table_name, t.table_type,
         c.column_name, c.data_type
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema not in ('pg_catalog', 'information_schema')
  order by c.table_schema, c.table_name, c.ordinal_position`;

// Independent schema list so empty schemas (e.g. brand-new public on a fresh
// Postgres database) still appear in the sidebar.
const SCHEMAS_SQL = `
  select schema_name
  from information_schema.schemata
  where schema_name not in ('pg_catalog', 'information_schema', 'pg_toast')
    and schema_name not like 'pg_temp_%'
    and schema_name not like 'pg_toast_temp_%'
  order by schema_name`;

// Functions and procedures in user schemas, including extension-installed ones.
// Uses pg_proc (not information_schema.routines) so that extension functions
// like uuid_generate_v4 appear. Excludes aggregates (prokind='a') and internal
// C functions that have no SQL-visible signature.
const FUNCTIONS_SQL = `
  select n.nspname as routine_schema,
         p.proname as routine_name,
         case when p.prokind = 'p' then 'PROCEDURE' else 'FUNCTION' end as routine_type,
         pg_catalog.format_type(p.prorettype, null) as data_type
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('pg_catalog', 'information_schema')
    and n.nspname not like 'pg_toast%'
    and p.prokind in ('f', 'p', 'w')
  order by n.nspname, p.proname`;

const PK_SQL = `
  select tc.table_schema, tc.table_name, kcu.column_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on kcu.constraint_name = tc.constraint_name
   and kcu.table_schema = tc.table_schema
  where tc.constraint_type = 'PRIMARY KEY'`;

// Foreign keys, joined to the matching referenced-column ordinal so composite
// FKs assemble cleanly.
const FK_SQL = `
  select rc.constraint_name,
         kcu.table_schema, kcu.table_name, kcu.column_name,
         ccu.table_schema as ref_schema, ccu.table_name as ref_table, ccu.column_name as ref_column,
         kcu.ordinal_position
  from information_schema.referential_constraints rc
  join information_schema.key_column_usage kcu
    on kcu.constraint_name = rc.constraint_name
   and kcu.constraint_schema = rc.constraint_schema
  join information_schema.constraint_column_usage ccu
    on ccu.constraint_name = rc.unique_constraint_name
   and ccu.constraint_schema = rc.unique_constraint_schema
  where kcu.table_schema not in ('pg_catalog', 'information_schema')
  order by rc.constraint_name, kcu.ordinal_position`;

// Shared introspection for Postgres-protocol engines (Postgres + PGlite).
// `runObjects` runs a SQL string and returns rows as plain objects.
export async function introspectPostgresLike(
  runObjects: (sql: string) => Promise<Record<string, unknown>[]>,
  databaseName: string,
): Promise<SchemaModel> {
  const [colRows, pkRows, fkRows, schemaRows, fnRows] = await Promise.all([
    runObjects(COLUMNS_SQL) as Promise<unknown[]>,
    runObjects(PK_SQL) as Promise<unknown[]>,
    runObjects(FK_SQL).catch(() => []) as Promise<unknown[]>,
    runObjects(SCHEMAS_SQL).catch(() => []) as Promise<unknown[]>,
    runObjects(FUNCTIONS_SQL).catch(() => []) as Promise<unknown[]>,
  ]);

  // Bucket functions by schema name for fast lookup when we assemble the model.
  const fnBySchema = new Map<string, FunctionInfo[]>();
  for (const r of fnRows as {
    routine_schema: string;
    routine_name: string;
    routine_type: string;
    data_type: string | null;
  }[]) {
    const list = fnBySchema.get(r.routine_schema) ?? [];
    list.push({
      name: r.routine_name,
      kind: r.routine_type === "PROCEDURE" ? "procedure" : "function",
      returnType: r.data_type ?? undefined,
    });
    fnBySchema.set(r.routine_schema, list);
  }

  const pkByTable = new Map<string, string[]>();
  for (const r of pkRows as PkRow[]) {
    const key = `${r.table_schema}.${r.table_name}`;
    const list = pkByTable.get(key) ?? [];
    list.push(r.column_name);
    pkByTable.set(key, list);
  }

  // Group FK rows by (table, constraint) to assemble composite keys.
  const fksByTable = new Map<string, ForeignKey[]>();
  const byConstraint = new Map<
    string,
    { row: FkRow; columns: string[]; refColumns: string[] }
  >();
  for (const r of fkRows as FkRow[]) {
    const ck = `${r.table_schema}.${r.table_name}.${r.constraint_name}`;
    const entry =
      byConstraint.get(ck) ?? { row: r, columns: [], refColumns: [] };
    entry.columns[r.ordinal_position - 1] = r.column_name;
    entry.refColumns[r.ordinal_position - 1] = r.ref_column;
    byConstraint.set(ck, entry);
  }
  for (const { row, columns, refColumns } of byConstraint.values()) {
    const tblKey = `${row.table_schema}.${row.table_name}`;
    const list = fksByTable.get(tblKey) ?? [];
    list.push({
      columns: columns.filter(Boolean),
      refSchema: row.ref_schema !== row.table_schema ? row.ref_schema : undefined,
      refTable: row.ref_table,
      refColumns: refColumns.filter(Boolean),
    });
    fksByTable.set(tblKey, list);
  }

  // schema -> table -> TableInfo. Seed with the independent schema list so
  // empty schemas (e.g. a fresh "public" with no tables) still appear.
  const schemas = new Map<string, Map<string, TableInfo>>();
  for (const r of schemaRows as { schema_name: string }[]) {
    if (r?.schema_name) schemas.set(r.schema_name, new Map());
  }
  // Belt-and-suspenders: every Postgres database has a `public` schema by
  // default. If the schemas query came back empty (permissions, exotic config,
  // or a silent catch above), make sure the user still sees it.
  if (schemas.size === 0) schemas.set("public", new Map());
  for (const r of colRows as ColRow[]) {
    const schemaTables = schemas.get(r.table_schema) ?? new Map<string, TableInfo>();
    schemas.set(r.table_schema, schemaTables);
    const tblKey = `${r.table_schema}.${r.table_name}`;
    const table =
      schemaTables.get(r.table_name) ??
      ({
        name: r.table_name,
        isView: /view/i.test(r.table_type),
        columns: [] as ColumnMeta[],
        primaryKey: pkByTable.get(tblKey) ?? [],
        foreignKeys: fksByTable.get(tblKey) ?? [],
      } satisfies TableInfo);
    schemaTables.set(r.table_name, table);
    table.columns.push({ name: r.column_name, type: r.data_type });
  }

  // Schemas that have functions but no tables wouldn't appear above; add them.
  for (const schemaName of fnBySchema.keys()) {
    if (!schemas.has(schemaName)) schemas.set(schemaName, new Map());
  }

  return {
    databases: [
      {
        name: databaseName,
        schemas: [...schemas.entries()]
          .map(([name, tableMap]) => ({
            name,
            tables: [...tableMap.values()],
            functions: fnBySchema.get(name) ?? [],
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      },
    ],
  };
}
