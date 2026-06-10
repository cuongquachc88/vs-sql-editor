import { readFile } from "node:fs/promises";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { applySelectPaging } from "./paging";
import {
  DriverError,
  type Capabilities,
  type ColumnMeta,
  type ConnectionProfile,
  type DatabaseDriver,
  type QueryOptions,
  type ResultSet,
  type SchemaModel,
  type Session,
  type TableInfo,
} from "./types";

interface SqliteSession extends Session {
  handle: Database;
}

// sql.js is a WASM build; the module is initialized once and reused.
let sqlPromise: Promise<SqlJsStatic> | undefined;
function getSql(): Promise<SqlJsStatic> {
  return (sqlPromise ??= initSqlJs());
}

export class SqliteDriver implements DatabaseDriver {
  readonly capabilities: Capabilities = {
    editRows: true,
    cancelQuery: false,
    transactions: true,
    multipleSchemas: false,
  };

  async connect(profile: ConnectionProfile): Promise<SqliteSession> {
    const SQL = await getSql();
    let db: Database;
    if (profile.filePath) {
      const buf = await readFile(profile.filePath).catch(() => undefined);
      db = buf ? new SQL.Database(new Uint8Array(buf)) : new SQL.Database();
    } else {
      db = new SQL.Database();
    }
    return { id: `sqlite-${profile.id}-${Date.now()}`, handle: db };
  }

  async query(session: Session, sql: string, opts: QueryOptions = {}): Promise<ResultSet> {
    const db = (session as SqliteSession).handle;
    const pageSize = opts.pageSize ?? 500;
    const page = opts.page ?? 0;
    const paged = applySelectPaging(sql, page, pageSize);
    try {
      const results = db.exec(paged);
      // A write (INSERT/UPDATE/...) returns no result set.
      if (results.length === 0) {
        return { columns: [], rows: [], page, pageSize, rowCount: db.getRowsModified() };
      }
      const first = results[0];
      const columns = first.columns.map((name) => ({ name, type: "" }));
      const rows = first.values as unknown[][];
      return { columns, rows, page, pageSize, hasMore: rows.length === pageSize };
    } catch (err) {
      throw new DriverError("QUERY_FAILED", (err as Error).message, (err as Error).stack);
    }
  }

  async introspect(session: Session): Promise<SchemaModel> {
    const db = (session as SqliteSession).handle;
    try {
      const objs = db.exec(
        "select name, type from sqlite_master where type in ('table','view') and name not like 'sqlite_%' order by name",
      );
      const tables: TableInfo[] = [];
      if (objs.length > 0) {
        for (const [name, type] of objs[0].values as [string, string][]) {
          const info = db.exec(`pragma table_info("${name.replace(/"/g, '""')}")`);
          const columns: ColumnMeta[] = [];
          const primaryKey: string[] = [];
          if (info.length > 0) {
            // pragma table_info columns: cid, name, type, notnull, dflt_value, pk
            for (const row of info[0].values) {
              const colName = String(row[1]);
              columns.push({ name: colName, type: String(row[2] ?? "") });
              if (Number(row[5]) > 0) primaryKey.push(colName);
            }
          }
          tables.push({ name, isView: type === "view", columns, primaryKey });
        }
      }
      return { databases: [{ name: "main", schemas: [{ name: "main", tables }] }] };
    } catch (err) {
      throw new DriverError("QUERY_FAILED", (err as Error).message, (err as Error).stack);
    }
  }

  buildEditStatement(): string {
    throw DriverError.notImplemented("buildEditStatement"); // Phase 5
  }

  async cancel(_session: Session): Promise<void> {
    throw new DriverError("CANCELLED", "SQLite (sql.js) does not support query cancellation");
  }

  async dispose(session: Session): Promise<void> {
    const db = (session as SqliteSession).handle;
    if (db) db.close();
  }
}
