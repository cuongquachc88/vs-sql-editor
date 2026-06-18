export type EngineId = "postgres" | "mysql" | "pglite" | "sqlite" | "clickhouse";

export interface Capabilities {
  editRows: boolean;
  cancelQuery: boolean;
  transactions: boolean;
  multipleSchemas: boolean;
}

export interface ConnectionProfile {
  id: string;
  name: string;
  engine: EngineId;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  filePath?: string; // sqlite
  options?: Record<string, string>;
}

export interface Session {
  id: string;
  // driver-private handle lives behind this; never serialized to a webview
  handle?: unknown;
}

export interface ColumnMeta {
  name: string;
  type: string;
}

export interface ResultSet {
  columns: ColumnMeta[];
  rows: unknown[][];
  page: number; // 0-based
  pageSize: number;
  rowCount?: number; // affected rows for non-SELECT, when known
  hasMore?: boolean; // true if another page likely exists
}

export interface QueryOptions {
  page?: number; // 0-based; default 0
  pageSize?: number; // default from config
  signal?: AbortSignal;
}

export interface ForeignKey {
  columns: string[];        // local columns (composite)
  refSchema?: string;       // omitted when same schema as the table
  refTable: string;
  refColumns: string[];     // matching columns in the referenced table
}

export interface TableInfo {
  name: string;
  isView: boolean;
  columns: ColumnMeta[];
  primaryKey: string[];
  foreignKeys: ForeignKey[];
}

export interface FunctionInfo {
  name: string;
  kind: "function" | "procedure"; // distinguish stored proc from function
  returnType?: string;
  arguments?: string; // raw "a int, b text" — for tooltip / quick view
}

export interface SchemaInfo {
  name: string;
  tables: TableInfo[];
  functions: FunctionInfo[];
}

export interface DatabaseInfo {
  name: string;
  schemas: SchemaInfo[];
}

export interface SchemaModel {
  databases: DatabaseInfo[];
}

export type DriverErrorCode =
  | "UNKNOWN"
  | "CONN_REFUSED"
  | "AUTH_FAILED"
  | "QUERY_FAILED"
  | "CANCELLED"
  | "NOT_IMPLEMENTED";

export class DriverError extends Error {
  constructor(
    public readonly code: DriverErrorCode,
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = "DriverError";
  }

  static from(err: unknown): DriverError {
    if (err instanceof DriverError) return err;
    const message = err instanceof Error ? err.message : String(err);
    const detail = err instanceof Error ? err.stack : undefined;
    return new DriverError("UNKNOWN", message, detail);
  }

  static notImplemented(what: string): DriverError {
    return new DriverError("NOT_IMPLEMENTED", `${what} is not implemented yet`);
  }
}

export interface DatabaseDriver {
  readonly capabilities: Capabilities;
  connect(profile: ConnectionProfile, secret?: string): Promise<Session>;
  query(session: Session, sql: string, opts?: QueryOptions): Promise<ResultSet>;
  introspect(session: Session): Promise<SchemaModel>;
  buildEditStatement(
    table: string,
    pk: Record<string, unknown>,
    changes: Record<string, unknown>,
  ): string;
  cancel(session: Session): Promise<void>;
  dispose(session: Session): Promise<void>;
}

export type DriverFactory = () => DatabaseDriver;
