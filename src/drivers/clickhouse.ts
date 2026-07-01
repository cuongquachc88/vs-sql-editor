import { readFile } from "node:fs/promises";
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
  type TableInfo,
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
    const ssl = profile.sslMode && profile.sslMode !== "disable";
    const defaultPort = ssl ? 8443 : 8123;
    const port = profile.port ?? defaultPort;
    const scheme = ssl ? "https" : "http";
    const tls = ssl ? await buildClickhouseTls(profile) : undefined;
    const client = createClient({
      url: `${scheme}://${host}:${port}`,
      username: profile.user || "default",
      password: secret ?? "",
      database: profile.database,
      tls,
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

  async introspect(session: Session): Promise<SchemaModel> {
    const client = (session as ClickhouseSession).handle;
    try {
      const dbRes = await client.query({ query: "select currentDatabase() as db", format: "JSON" });
      const dbJson = (await dbRes.json()) as { data: { db: string }[] };
      const databaseName = dbJson.data[0]?.db ?? "default";

      const colRes = await client.query({
        query: `select c.table as t, c.name as col, c.type as dt,
                       t.engine as engine
                from system.columns c
                join system.tables t on t.database = c.database and t.name = c.table
                where c.database = {db:String}
                order by c.table, c.position`,
        query_params: { db: databaseName },
        format: "JSON",
      });
      const colJson = (await colRes.json()) as {
        data: { t: string; col: string; dt: string; engine: string }[];
      };

      const tableMap = new Map<string, TableInfo>();
      for (const r of colJson.data) {
        const table =
          tableMap.get(r.t) ??
          ({
            name: r.t,
            isView: /view/i.test(r.engine),
            columns: [],
            primaryKey: [],
            foreignKeys: [],
          } satisfies TableInfo);
        tableMap.set(r.t, table);
        table.columns.push({ name: r.col, type: r.dt });
      }

      return {
        databases: [
          {
            name: databaseName,
            schemas: [
              { name: databaseName, tables: [...tableMap.values()], functions: [] },
            ],
          },
        ],
      };
    } catch (err) {
      throw new DriverError("QUERY_FAILED", (err as Error).message, (err as Error).stack);
    }
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

// Returns a BasicTLSOptions object only when a CA cert path is supplied.
// For plain "require" (https without cert verification), just using https://
// in the URL is sufficient — no extra tls config needed.
async function buildClickhouseTls(
  profile: ConnectionProfile,
): Promise<{ ca_cert: Buffer } | undefined> {
  if (
    profile.sslCa &&
    (profile.sslMode === "verify-ca" || profile.sslMode === "verify-full")
  ) {
    const ca = await readFile(profile.sslCa);
    return { ca_cert: ca };
  }
  return undefined;
}
