import { Client } from "pg";
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

interface PgSession extends Session {
  handle: Client;
}

export class PostgresDriver implements DatabaseDriver {
  readonly capabilities: Capabilities = {
    editRows: true,
    cancelQuery: true,
    transactions: true,
    multipleSchemas: true,
  };

  async connect(profile: ConnectionProfile, secret?: string): Promise<PgSession> {
    const client = new Client({
      host: profile.host,
      port: profile.port,
      database: profile.database,
      user: profile.user,
      password: secret,
    });
    try {
      await client.connect();
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      const code =
        e.code === "ECONNREFUSED"
          ? "CONN_REFUSED"
          : /password|auth/i.test(e.message)
            ? "AUTH_FAILED"
            : "UNKNOWN";
      throw new DriverError(code, e.message, e.code);
    }
    return { id: `pg-${profile.id}-${Date.now()}`, handle: client };
  }

  async query(session: Session, sql: string, opts: QueryOptions = {}): Promise<ResultSet> {
    const client = (session as PgSession).handle;
    const pageSize = opts.pageSize ?? 500;
    const page = opts.page ?? 0;
    const paged = applySelectPaging(sql, page, pageSize);
    try {
      const res = await client.query({ text: paged, rowMode: "array" });
      const columns = res.fields.map((f) => ({ name: f.name, type: String(f.dataTypeID) }));
      const rows = res.rows as unknown[][];
      return {
        columns,
        rows,
        page,
        pageSize,
        rowCount: res.rowCount ?? undefined,
        hasMore: rows.length === pageSize,
      };
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
    // pg cancels in-flight queries by opening a side connection; simplest reliable
    // approach is to end the client, which aborts the running query.
    await this.dispose(session);
  }

  async dispose(session: Session): Promise<void> {
    const client = (session as PgSession).handle;
    if (client) await client.end().catch(() => undefined);
  }
}
