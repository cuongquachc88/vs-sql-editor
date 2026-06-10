import { applySelectPaging } from "./paging";
import { introspectPostgresLike } from "./introspect-pg";
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

// PGlite is ESM-only; load it via dynamic import so a CJS extension bundle can
// still consume it at runtime (works on the VS Code/Electron Node runtime).
type PGliteInstance = {
  query: (
    sql: string,
    params?: unknown[],
    opts?: { rowMode?: "array" | "object" },
  ) => Promise<{ rows: unknown[]; fields: { name: string; dataTypeID: number }[]; affectedRows?: number }>;
  close: () => Promise<void>;
};

interface PgliteSession extends Session {
  handle: PGliteInstance;
}

export class PgliteDriver implements DatabaseDriver {
  readonly capabilities: Capabilities = {
    editRows: true,
    cancelQuery: false,
    transactions: true,
    multipleSchemas: true,
  };

  async connect(profile: ConnectionProfile): Promise<PgliteSession> {
    const { PGlite } = (await import("@electric-sql/pglite")) as {
      PGlite: new (dataDir?: string) => PGliteInstance & { waitReady?: Promise<void> };
    };
    try {
      // filePath => persistent data directory; omitted => ephemeral in-memory.
      const db = new PGlite(profile.filePath || undefined);
      if (db.waitReady) await db.waitReady;
      return { id: `pglite-${profile.id}-${Date.now()}`, handle: db };
    } catch (err) {
      throw new DriverError("CONN_REFUSED", (err as Error).message, (err as Error).stack);
    }
  }

  async query(session: Session, sql: string, opts: QueryOptions = {}): Promise<ResultSet> {
    const db = (session as PgliteSession).handle;
    const pageSize = opts.pageSize ?? 500;
    const page = opts.page ?? 0;
    const paged = applySelectPaging(sql, page, pageSize);
    try {
      const res = await db.query(paged, [], { rowMode: "array" });
      const columns = res.fields.map((f) => ({ name: f.name, type: String(f.dataTypeID) }));
      const rows = res.rows as unknown[][];
      return {
        columns,
        rows,
        page,
        pageSize,
        rowCount: res.affectedRows,
        hasMore: rows.length === pageSize,
      };
    } catch (err) {
      throw new DriverError("QUERY_FAILED", (err as Error).message, (err as Error).stack);
    }
  }

  async introspect(session: Session): Promise<SchemaModel> {
    const db = (session as PgliteSession).handle;
    try {
      // No rowMode => rows come back as plain objects.
      const dbRes = await db.query("select current_database() as db");
      const databaseName = (dbRes.rows[0] as { db: string }).db;
      return await introspectPostgresLike(
        async (sql) => (await db.query(sql)).rows as Record<string, unknown>[],
        databaseName,
      );
    } catch (err) {
      throw new DriverError("QUERY_FAILED", (err as Error).message, (err as Error).stack);
    }
  }

  buildEditStatement(): string {
    throw DriverError.notImplemented("buildEditStatement"); // Phase 5
  }

  async cancel(_session: Session): Promise<void> {
    // PGlite runs queries in-process with no cancel primitive.
    throw new DriverError("CANCELLED", "PGlite does not support query cancellation");
  }

  async dispose(session: Session): Promise<void> {
    const db = (session as PgliteSession).handle;
    if (db) await db.close().catch(() => undefined);
  }
}
