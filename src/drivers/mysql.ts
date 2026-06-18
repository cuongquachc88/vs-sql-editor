import { createConnection, type Connection, type FieldPacket } from "mysql2/promise";
import { applySelectPaging } from "./paging";
import { buildUpdate, quoteBacktick } from "../edit/sql";
import {
  DriverError,
  type Capabilities,
  type ConnectionProfile,
  type DatabaseDriver,
  type QueryOptions,
  type ResultSet,
  type SchemaModel,
  type Session,
  type ForeignKey,
  type TableInfo,
} from "./types";

interface MysqlSession extends Session {
  handle: Connection;
}

export class MysqlDriver implements DatabaseDriver {
  readonly capabilities: Capabilities = {
    editRows: true,
    cancelQuery: true,
    transactions: true,
    multipleSchemas: true,
  };

  async connect(profile: ConnectionProfile, secret?: string): Promise<MysqlSession> {
    try {
      const conn = await createConnection({
        host: profile.host,
        port: profile.port,
        user: profile.user,
        password: secret,
        database: profile.database,
      });
      return { id: `mysql-${profile.id}-${Date.now()}`, handle: conn };
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { code?: string };
      const code =
        e.code === "ECONNREFUSED"
          ? "CONN_REFUSED"
          : e.code === "ER_ACCESS_DENIED_ERROR"
            ? "AUTH_FAILED"
            : "UNKNOWN";
      throw new DriverError(code, e.message, e.code);
    }
  }

  async query(session: Session, sql: string, opts: QueryOptions = {}): Promise<ResultSet> {
    const conn = (session as MysqlSession).handle;
    const pageSize = opts.pageSize ?? 500;
    const page = opts.page ?? 0;
    const paged = applySelectPaging(sql, page, pageSize);
    try {
      const [rowsRaw, fields] = await conn.query({ sql: paged, rowsAsArray: true });
      // Non-SELECT results come back as an OkPacket (not an array).
      if (!Array.isArray(rowsRaw)) {
        const ok = rowsRaw as { affectedRows?: number };
        return { columns: [], rows: [], page, pageSize, rowCount: ok.affectedRows };
      }
      const columns = (fields ?? []).map((f: FieldPacket) => ({
        name: f.name,
        type: String((f as FieldPacket & { columnType?: number }).columnType ?? ""),
      }));
      const rows = rowsRaw as unknown[][];
      return { columns, rows, page, pageSize, hasMore: rows.length === pageSize };
    } catch (err) {
      throw new DriverError("QUERY_FAILED", (err as Error).message, (err as Error).stack);
    }
  }

  async introspect(session: Session): Promise<SchemaModel> {
    const conn = (session as MysqlSession).handle;
    try {
      const [dbRows] = await conn.query("select database() as db");
      const databaseName = (dbRows as { db: string | null }[])[0]?.db;
      if (!databaseName) {
        // No database selected on the connection; nothing to introspect.
        return { databases: [] };
      }
      const [colRows] = await conn.query(
        `select c.table_name as t, c.column_name as col, c.data_type as dt, t.table_type as tt
         from information_schema.columns c
         join information_schema.tables t
           on t.table_schema = c.table_schema and t.table_name = c.table_name
         where c.table_schema = ?
         order by c.table_name, c.ordinal_position`,
        [databaseName],
      );
      const [pkRows] = await conn.query(
        `select table_name as t, column_name as col
         from information_schema.key_column_usage
         where table_schema = ? and constraint_name = 'PRIMARY'`,
        [databaseName],
      );

      const [fkRows] = await conn.query(
        `select table_name as t, column_name as col,
                referenced_table_schema as rs, referenced_table_name as rt, referenced_column_name as rc,
                constraint_name as cn, ordinal_position as op
         from information_schema.key_column_usage
         where table_schema = ? and referenced_table_name is not null
         order by t, cn, op`,
        [databaseName],
      );

      const pkByTable = new Map<string, string[]>();
      for (const r of pkRows as { t: string; col: string }[]) {
        const list = pkByTable.get(r.t) ?? [];
        list.push(r.col);
        pkByTable.set(r.t, list);
      }

      // Group FK rows by (table, constraint).
      const fksByTable = new Map<string, ForeignKey[]>();
      type FkR = {
        t: string;
        col: string;
        rs: string | null;
        rt: string;
        rc: string;
        cn: string;
        op: number;
      };
      const byConstraint = new Map<string, { row: FkR; cols: string[]; refs: string[] }>();
      for (const r of fkRows as FkR[]) {
        const key = `${r.t}.${r.cn}`;
        const entry = byConstraint.get(key) ?? { row: r, cols: [], refs: [] };
        entry.cols[r.op - 1] = r.col;
        entry.refs[r.op - 1] = r.rc;
        byConstraint.set(key, entry);
      }
      for (const { row, cols, refs } of byConstraint.values()) {
        const list = fksByTable.get(row.t) ?? [];
        list.push({
          columns: cols.filter(Boolean),
          refSchema: row.rs && row.rs !== databaseName ? row.rs : undefined,
          refTable: row.rt,
          refColumns: refs.filter(Boolean),
        });
        fksByTable.set(row.t, list);
      }

      const tableMap = new Map<string, TableInfo>();
      for (const r of colRows as { t: string; col: string; dt: string; tt: string }[]) {
        const table =
          tableMap.get(r.t) ??
          ({
            name: r.t,
            isView: /view/i.test(r.tt),
            columns: [],
            primaryKey: pkByTable.get(r.t) ?? [],
            foreignKeys: fksByTable.get(r.t) ?? [],
          } satisfies TableInfo);
        tableMap.set(r.t, table);
        table.columns.push({ name: r.col, type: r.dt });
      }

      // User-defined functions / procedures in the current database.
      const [fnRows] = await conn
        .query(
          `select routine_name as n, routine_type as t, data_type as dt
             from information_schema.routines
            where routine_schema = ?`,
          [databaseName],
        )
        .catch(() => [[]] as never);
      const functions = (fnRows as { n: string; t: string; dt: string | null }[]).map(
        (r) => ({
          name: r.n,
          kind: r.t === "PROCEDURE" ? ("procedure" as const) : ("function" as const),
          returnType: r.dt ?? undefined,
        }),
      );

      return {
        databases: [
          {
            name: databaseName,
            schemas: [
              {
                name: databaseName,
                tables: [...tableMap.values()],
                functions,
              },
            ],
          },
        ],
      };
    } catch (err) {
      throw new DriverError("QUERY_FAILED", (err as Error).message, (err as Error).stack);
    }
  }

  buildEditStatement(
    table: string,
    pk: Record<string, unknown>,
    changes: Record<string, unknown>,
  ): string {
    return buildUpdate(quoteBacktick, table, pk, changes);
  }

  async cancel(session: Session): Promise<void> {
    // Ending the connection aborts the in-flight query.
    await this.dispose(session);
  }

  async dispose(session: Session): Promise<void> {
    const conn = (session as MysqlSession).handle;
    if (conn) await conn.end().catch(() => undefined);
  }
}
