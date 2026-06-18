import type { EngineId } from "../drivers/types";

export type RefAction = "CASCADE" | "SET NULL" | "RESTRICT" | "NO ACTION" | "SET DEFAULT";

export interface TableColumn {
  name: string;
  type: string; // raw engine-specific type, e.g. "int4", "varchar(64)", "Int64"
  nullable: boolean;
  default?: string; // raw SQL expression, e.g. "now()", "0", "'pending'"
  isPrimary: boolean;
  comment?: string;
}

export interface ForeignKey {
  name?: string; // generated if omitted
  columns: string[];
  refSchema?: string;
  refTable: string;
  refColumns: string[];
  onUpdate?: RefAction;
  onDelete?: RefAction;
}

export interface IndexDef {
  name?: string;
  columns: string[];
  unique: boolean;
}

export interface CheckConstraint {
  name?: string;
  expression: string;
}

export interface TableSchema {
  schema: string; // e.g. "public" (postgres). May be "" / "main" depending on engine.
  name: string;
  columns: TableColumn[];
  foreignKeys: ForeignKey[];
  indexes: IndexDef[];
  checks: CheckConstraint[];
}

export type DesignerMode = "create" | "edit";

// Catalog of common types per engine, used to populate the UI dropdown.
export const TYPE_CATALOG: Record<EngineId, string[]> = {
  postgres: [
    "bigint",
    "integer",
    "smallint",
    "numeric(10,2)",
    "double precision",
    "real",
    "text",
    "varchar(255)",
    "boolean",
    "uuid",
    "jsonb",
    "json",
    "timestamptz",
    "timestamp",
    "date",
    "time",
    "interval",
    "bytea",
  ],
  pglite: [
    "bigint",
    "integer",
    "smallint",
    "numeric(10,2)",
    "double precision",
    "real",
    "text",
    "varchar(255)",
    "boolean",
    "uuid",
    "jsonb",
    "json",
    "timestamptz",
    "timestamp",
    "date",
    "time",
    "interval",
    "bytea",
  ],
  mysql: [
    "bigint",
    "int",
    "smallint",
    "tinyint",
    "decimal(10,2)",
    "double",
    "float",
    "text",
    "varchar(255)",
    "char(64)",
    "tinyint(1)",
    "datetime",
    "timestamp",
    "date",
    "time",
    "json",
    "blob",
  ],
  sqlite: ["INTEGER", "TEXT", "REAL", "BLOB", "NUMERIC"],
  clickhouse: [
    "Int64",
    "Int32",
    "UInt64",
    "UInt32",
    "Float64",
    "Float32",
    "String",
    "FixedString(32)",
    "Bool",
    "DateTime",
    "DateTime64(3)",
    "Date",
    "UUID",
    "Decimal(10,2)",
  ],
};

// Whether the engine supports multi-schema (DB.schema.table). Affects UI.
export function isMultiSchema(engine: EngineId): boolean {
  return engine === "postgres" || engine === "pglite" || engine === "clickhouse";
}

export function defaultSchema(engine: EngineId): string {
  if (engine === "postgres" || engine === "pglite") return "public";
  if (engine === "sqlite") return "main";
  if (engine === "clickhouse") return "default";
  return "";
}

export function emptyTable(engine: EngineId, schema: string): TableSchema {
  return {
    schema,
    name: "",
    columns: [
      {
        name: "id",
        type:
          engine === "mysql"
            ? "bigint"
            : engine === "sqlite"
              ? "INTEGER"
              : engine === "clickhouse"
                ? "UInt64"
                : "bigint",
        nullable: false,
        isPrimary: true,
      },
    ],
    foreignKeys: [],
    indexes: [],
    checks: [],
  };
}
