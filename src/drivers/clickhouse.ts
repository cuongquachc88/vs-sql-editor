import { createClient, type ClickHouseClient } from "@clickhouse/client";
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

interface ClickhouseSession extends Session {
  handle: ClickHouseClient;
}

const READS = /^\s*(select|with|show|describe|desc|explain)\b/i;

export class ClickhouseDriver implements DatabaseDriver {
  // ClickHouse is append-oriented: no cheap row UPDATE/DELETE, so editRows is false.
  readonly capabilities: Capabilities = {
    editRows: false,
    cancelQuery: false,
    transactions: false,
    multipleSchemas: true,
  };

  async connect(profile: ConnectionProfile, secret?: string): Promise<ClickhouseSession> {
    const host = profile.host ?? "localhost";
    const port = profile.port ?? 8123;
    const client = createClient({
      url: `http://${host}:${port}`,
      username: profile.user || "default",
      password: secret ?? "",
      database: profile.database,
    });
    try {
      const ping = await client.ping();
      if (!ping.success) {
        throw new DriverError("CONN_REFUSED", ping.error?.message ?? "ping failed");
      }
    } catch (err) {
      if (err instanceof DriverError) throw err;
      throw new DriverError("CONN_REFUSED", (err as Error).message, (err as Error).stack);
    }
    return { id: `clickhouse-${profile.id}-${Date.now()}`, handle: client };
  }

  async query(session: Session, sql: string, opts: QueryOptions = {}): Promise<ResultSet> {
    const client = (session as ClickhouseSession).handle;
    const pageSize = opts.pageSize ?? 500;
    const page = opts.page ?? 0;

    try {
      if (!READS.test(sql)) {
        // DDL / INSERT: no result set to return.
        await client.command({ query: sql.trim().replace(/;\s*$/, "") });
        return { columns: [], rows: [], page, pageSize };
      }
      const paged = applySelectPaging(sql, page, pageSize);
      const resultSet = await client.query({ query: paged, format: "JSONCompact" });
      const json = (await resultSet.json()) as {
        meta: { name: string; type: string }[];
        data: unknown[][];
      };
      const columns = json.meta.map((m) => ({ name: m.name, type: m.type }));
      const rows = json.data;
      return { columns, rows, page, pageSize, hasMore: rows.length === pageSize };
    } catch (err) {
      throw new DriverError("QUERY_FAILED", (err as Error).message, (err as Error).stack);
    }
  }

  async introspect(_session: Session): Promise<SchemaModel> {
    throw DriverError.notImplemented("introspect"); // Phase 3
  }

  buildEditStatement(): string {
    // editRows is false; the grid never offers editing for ClickHouse.
    throw new DriverError("NOT_IMPLEMENTED", "ClickHouse does not support inline row editing");
  }

  async cancel(_session: Session): Promise<void> {
    throw new DriverError("CANCELLED", "ClickHouse query cancellation is not supported");
  }

  async dispose(session: Session): Promise<void> {
    const client = (session as ClickhouseSession).handle;
    if (client) await client.close().catch(() => undefined);
  }
}
