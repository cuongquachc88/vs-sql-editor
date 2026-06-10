import { createConnection, type Connection, type FieldPacket } from "mysql2/promise";
import { applySelectPaging } from "./paging";
import {
  DriverError,
  type Capabilities,
  type ConnectionProfile,
  type DatabaseDriver,
  type QueryOptions,
  type ResultSet,
  type SchemaModel,
  type Session,
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

  async introspect(_session: Session): Promise<SchemaModel> {
    throw DriverError.notImplemented("introspect"); // Phase 3
  }

  buildEditStatement(): string {
    throw DriverError.notImplemented("buildEditStatement"); // Phase 5
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
