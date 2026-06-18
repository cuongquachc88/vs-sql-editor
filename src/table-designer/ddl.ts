import type { EngineId } from "../drivers/types";
import { quoteIdent } from "../import/sql-types";
import type { TableSchema, TableColumn, ForeignKey, IndexDef, CheckConstraint } from "./model";

// =============================================================================
// CREATE TABLE
// =============================================================================

export function generateCreateTable(engine: EngineId, t: TableSchema): string[] {
  const stmts: string[] = [];
  const colDefs = t.columns.map((c) => columnDef(engine, c));
  const pkCols = t.columns.filter((c) => c.isPrimary).map((c) => c.name);
  // For Postgres/MySQL/SQLite single-PK inline; composite or 0 → table-level.
  const usingInlinePk =
    pkCols.length === 1 &&
    (engine === "postgres" ||
      engine === "pglite" ||
      engine === "mysql" ||
      engine === "sqlite");
  if (usingInlinePk) {
    const idx = t.columns.findIndex((c) => c.isPrimary);
    if (idx >= 0) colDefs[idx] = colDefs[idx] + " PRIMARY KEY";
  }
  const tableLevel: string[] = [];
  if (!usingInlinePk && pkCols.length > 0) {
    tableLevel.push(
      `PRIMARY KEY (${pkCols.map((c) => quoteIdent(engine, c)).join(", ")})`,
    );
  }
  for (const ck of t.checks) {
    const name = ck.name ? `CONSTRAINT ${quoteIdent(engine, ck.name)} ` : "";
    tableLevel.push(`${name}CHECK (${ck.expression})`);
  }
  // FKs are declared at table level inside CREATE for Postgres/MySQL; SQLite
  // requires them inside CREATE TABLE.
  if (engine !== "clickhouse") {
    for (const fk of t.foreignKeys) {
      tableLevel.push(fkClause(engine, fk));
    }
  }
  const allLines = [...colDefs, ...tableLevel];
  const ref = qualify(engine, t.schema, t.name);
  if (engine === "clickhouse") {
    // ClickHouse needs an ENGINE clause and ORDER BY. Default to MergeTree
    // ordered by the first PK column (or first column).
    const orderBy =
      pkCols.length > 0
        ? pkCols.map((c) => quoteIdent(engine, c)).join(", ")
        : quoteIdent(engine, t.columns[0]?.name ?? "id");
    stmts.push(
      `CREATE TABLE ${ref} (\n  ${allLines.join(",\n  ")}\n)\nENGINE = MergeTree()\nORDER BY (${orderBy})`,
    );
  } else {
    stmts.push(`CREATE TABLE ${ref} (\n  ${allLines.join(",\n  ")}\n)`);
  }
  // Indexes after CREATE TABLE (and FKs for ClickHouse: skip — not supported).
  for (const idx of t.indexes) {
    stmts.push(createIndexSql(engine, t.schema, t.name, idx));
  }
  // Column comments (Postgres-only).
  if (engine === "postgres" || engine === "pglite") {
    for (const c of t.columns) {
      if (c.comment) {
        stmts.push(
          `COMMENT ON COLUMN ${ref}.${quoteIdent(engine, c.name)} IS '${escapeSqlString(c.comment)}'`,
        );
      }
    }
  }
  return stmts;
}

function columnDef(engine: EngineId, c: TableColumn): string {
  let def = `${quoteIdent(engine, c.name)} ${c.type}`;
  if (!c.nullable) def += " NOT NULL";
  if (c.default != null && c.default !== "") def += ` DEFAULT ${c.default}`;
  // MySQL inline comment supported on column; others not.
  if ((engine === "mysql") && c.comment) {
    def += ` COMMENT '${escapeSqlString(c.comment)}'`;
  }
  return def;
}

function fkClause(engine: EngineId, fk: ForeignKey): string {
  const name = fk.name ? `CONSTRAINT ${quoteIdent(engine, fk.name)} ` : "";
  const cols = fk.columns.map((c) => quoteIdent(engine, c)).join(", ");
  const refTable = fk.refSchema
    ? `${quoteIdent(engine, fk.refSchema)}.${quoteIdent(engine, fk.refTable)}`
    : quoteIdent(engine, fk.refTable);
  const refCols = fk.refColumns.map((c) => quoteIdent(engine, c)).join(", ");
  let s = `${name}FOREIGN KEY (${cols}) REFERENCES ${refTable} (${refCols})`;
  if (fk.onUpdate) s += ` ON UPDATE ${fk.onUpdate}`;
  if (fk.onDelete) s += ` ON DELETE ${fk.onDelete}`;
  return s;
}

function createIndexSql(
  engine: EngineId,
  schema: string,
  table: string,
  idx: IndexDef,
): string {
  const ref = qualify(engine, schema, table);
  const name = idx.name ?? `idx_${table}_${idx.columns.join("_")}`;
  const cols = idx.columns.map((c) => quoteIdent(engine, c)).join(", ");
  const unique = idx.unique ? "UNIQUE " : "";
  return `CREATE ${unique}INDEX ${quoteIdent(engine, name)} ON ${ref} (${cols})`;
}

function qualify(engine: EngineId, schema: string, table: string): string {
  if (!schema || engine === "sqlite" || engine === "mysql")
    return quoteIdent(engine, table);
  return `${quoteIdent(engine, schema)}.${quoteIdent(engine, table)}`;
}

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}

// =============================================================================
// ALTER TABLE — diff old vs new
// =============================================================================

export function generateAlterTable(
  engine: EngineId,
  oldT: TableSchema,
  newT: TableSchema,
): string[] {
  const stmts: string[] = [];
  const oldRef = qualify(engine, oldT.schema, oldT.name);
  const newRef = qualify(engine, newT.schema, newT.name);

  // Rename
  if (oldT.name !== newT.name) {
    if (engine === "postgres" || engine === "pglite") {
      stmts.push(`ALTER TABLE ${oldRef} RENAME TO ${quoteIdent(engine, newT.name)}`);
    } else if (engine === "mysql") {
      stmts.push(`RENAME TABLE ${oldRef} TO ${quoteIdent(engine, newT.name)}`);
    } else if (engine === "sqlite") {
      stmts.push(`ALTER TABLE ${oldRef} RENAME TO ${quoteIdent(engine, newT.name)}`);
    } else if (engine === "clickhouse") {
      stmts.push(`RENAME TABLE ${oldRef} TO ${newRef}`);
    }
  }

  // Diff columns by NAME for now (rename detection deferred).
  const oldByName = new Map(oldT.columns.map((c) => [c.name, c]));
  const newByName = new Map(newT.columns.map((c) => [c.name, c]));
  const ref = newRef;

  // Dropped columns
  for (const c of oldT.columns) {
    if (!newByName.has(c.name)) {
      stmts.push(`ALTER TABLE ${ref} DROP COLUMN ${quoteIdent(engine, c.name)}`);
    }
  }
  // Added columns
  for (const c of newT.columns) {
    if (!oldByName.has(c.name)) {
      stmts.push(`ALTER TABLE ${ref} ADD COLUMN ${columnDef(engine, c)}`);
    }
  }
  // Modified columns (type / null / default)
  for (const c of newT.columns) {
    const o = oldByName.get(c.name);
    if (!o) continue;
    if (o.type !== c.type) {
      if (engine === "postgres" || engine === "pglite") {
        stmts.push(
          `ALTER TABLE ${ref} ALTER COLUMN ${quoteIdent(engine, c.name)} TYPE ${c.type}`,
        );
      } else if (engine === "mysql") {
        stmts.push(
          `ALTER TABLE ${ref} MODIFY COLUMN ${columnDef(engine, c)}`,
        );
      } else if (engine === "sqlite") {
        // SQLite cannot ALTER COLUMN TYPE — emit a comment.
        stmts.push(
          `-- SQLite does not support altering column type directly: ${c.name}. Recreate the table.`,
        );
      } else if (engine === "clickhouse") {
        stmts.push(
          `ALTER TABLE ${ref} MODIFY COLUMN ${quoteIdent(engine, c.name)} ${c.type}`,
        );
      }
    }
    if (o.nullable !== c.nullable && (engine === "postgres" || engine === "pglite")) {
      stmts.push(
        `ALTER TABLE ${ref} ALTER COLUMN ${quoteIdent(engine, c.name)} ${c.nullable ? "DROP NOT NULL" : "SET NOT NULL"}`,
      );
    }
    if (o.default !== c.default && (engine === "postgres" || engine === "pglite")) {
      if (c.default) {
        stmts.push(
          `ALTER TABLE ${ref} ALTER COLUMN ${quoteIdent(engine, c.name)} SET DEFAULT ${c.default}`,
        );
      } else {
        stmts.push(
          `ALTER TABLE ${ref} ALTER COLUMN ${quoteIdent(engine, c.name)} DROP DEFAULT`,
        );
      }
    }
  }

  // FKs/Indexes/Checks diff: drop removed + add new (no fine-grained edits).
  for (const fk of oldT.foreignKeys) {
    const present = newT.foreignKeys.find((x) => sameFk(x, fk));
    if (!present && fk.name) {
      stmts.push(`ALTER TABLE ${ref} DROP CONSTRAINT ${quoteIdent(engine, fk.name)}`);
    }
  }
  for (const fk of newT.foreignKeys) {
    const wasPresent = oldT.foreignKeys.find((x) => sameFk(x, fk));
    if (!wasPresent && engine !== "clickhouse") {
      stmts.push(`ALTER TABLE ${ref} ADD ${fkClause(engine, fk)}`);
    }
  }
  for (const idx of oldT.indexes) {
    const stillThere = newT.indexes.find((x) => sameIndex(x, idx));
    if (!stillThere && idx.name) {
      stmts.push(
        engine === "mysql"
          ? `DROP INDEX ${quoteIdent(engine, idx.name)} ON ${ref}`
          : `DROP INDEX ${quoteIdent(engine, idx.name)}`,
      );
    }
  }
  for (const idx of newT.indexes) {
    const wasThere = oldT.indexes.find((x) => sameIndex(x, idx));
    if (!wasThere) stmts.push(createIndexSql(engine, newT.schema, newT.name, idx));
  }
  for (const ck of oldT.checks) {
    const stillThere = newT.checks.find((x) => sameCheck(x, ck));
    if (!stillThere && ck.name) {
      stmts.push(`ALTER TABLE ${ref} DROP CONSTRAINT ${quoteIdent(engine, ck.name)}`);
    }
  }
  for (const ck of newT.checks) {
    const wasThere = oldT.checks.find((x) => sameCheck(x, ck));
    if (!wasThere) {
      const name = ck.name ? ` CONSTRAINT ${quoteIdent(engine, ck.name)}` : "";
      stmts.push(`ALTER TABLE ${ref} ADD${name} CHECK (${ck.expression})`);
    }
  }
  return stmts;
}

function sameFk(a: ForeignKey, b: ForeignKey): boolean {
  return (
    a.columns.join(",") === b.columns.join(",") &&
    a.refTable === b.refTable &&
    a.refColumns.join(",") === b.refColumns.join(",")
  );
}
function sameIndex(a: IndexDef, b: IndexDef): boolean {
  return a.columns.join(",") === b.columns.join(",") && a.unique === b.unique;
}
function sameCheck(a: CheckConstraint, b: CheckConstraint): boolean {
  return a.expression.trim() === b.expression.trim();
}
