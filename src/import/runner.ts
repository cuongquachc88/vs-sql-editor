import type { ConnectionManager } from "../connections/manager";
import type { EngineId } from "../drivers/types";
import { DriverError } from "../drivers/types";
import { quoteIdent, sqlTypeFor, type InferredType } from "./sql-types";

export interface ColumnSpec {
  name: string;
  type: InferredType;
}

export interface ImportOptions {
  manager: ConnectionManager;
  profileId: string;
  engine: EngineId;
  targetSchema?: string;
  targetTable: string;
  columns: ColumnSpec[];
  rows: string[][];
  batchSize?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface ImportResult {
  rowsInserted: number;
}

export async function importCsvIntoTable(opts: ImportOptions): Promise<ImportResult> {
  const {
    manager,
    profileId,
    engine,
    targetSchema,
    targetTable,
    columns,
    rows,
    batchSize = 500,
    onProgress,
    signal,
  } = opts;

  const ref = qualifyForCreate(engine, targetSchema, targetTable);
  const createSql = `create table if not exists ${ref} (\n${columns
    .map((c) => `  ${quoteIdent(engine, c.name)} ${sqlTypeFor(engine, c.type)}`)
    .join(",\n")}\n)`;

  const session = await manager.get(profileId);
  const driver = manager.driverOf(profileId);
  if (!driver) throw new DriverError("UNKNOWN", "Driver not available");

  try {
    await driver.query(session, createSql);
  } catch (err) {
    throw DriverError.from(err);
  }

  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    if (signal?.aborted) throw new DriverError("CANCELLED", "Import cancelled");
    const batch = rows.slice(i, i + batchSize);
    const sql = buildInsertSql(engine, ref, columns, batch);
    try {
      await driver.query(session, sql);
    } catch (err) {
      throw DriverError.from(err);
    }
    inserted += batch.length;
    onProgress?.(inserted, rows.length);
  }

  return { rowsInserted: inserted };
}

function qualifyForCreate(engine: EngineId, schema: string | undefined, table: string): string {
  if (!schema) return quoteIdent(engine, table);
  return `${quoteIdent(engine, schema)}.${quoteIdent(engine, table)}`;
}

// Inline-value INSERT — works across every supported driver including sql.js
// which doesn't accept parameterized batches via our DatabaseDriver shape.
export function buildInsertSql(
  engine: EngineId,
  qualifiedTable: string,
  columns: ColumnSpec[],
  rows: string[][],
): string {
  const cols = columns.map((c) => quoteIdent(engine, c.name)).join(", ");
  const values = rows
    .map(
      (r) =>
        "(" +
        columns
          .map((c, i) => literalFor(engine, c.type, r[i] ?? ""))
          .join(", ") +
        ")",
    )
    .join(",\n");
  return `insert into ${qualifiedTable} (${cols}) values\n${values}`;
}

function literalFor(engine: EngineId, type: InferredType, value: string): string {
  if (value === "") return "NULL";
  if (type === "integer") {
    return /^-?\d+$/.test(value.trim()) ? value.trim() : sqlString(engine, value);
  }
  if (type === "real") {
    return /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(value.trim())
      ? value.trim()
      : sqlString(engine, value);
  }
  if (type === "boolean") {
    const lo = value.trim().toLowerCase();
    if (lo === "true" || lo === "t" || lo === "1") return engine === "mysql" ? "1" : "TRUE";
    if (lo === "false" || lo === "f" || lo === "0") return engine === "mysql" ? "0" : "FALSE";
    return sqlString(engine, value);
  }
  return sqlString(engine, value);
}

function sqlString(_engine: EngineId, s: string): string {
  // Standard SQL single-quote escape.
  return `'${s.replace(/'/g, "''")}'`;
}
