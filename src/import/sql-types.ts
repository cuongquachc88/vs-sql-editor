import type { EngineId } from "../drivers/types";

export type InferredType = "integer" | "real" | "boolean" | "text";

// Per-engine SQL type that corresponds to each inferred type.
const TYPE_MAP: Record<EngineId, Record<InferredType, string>> = {
  postgres: {
    integer: "bigint",
    real: "double precision",
    boolean: "boolean",
    text: "text",
  },
  pglite: {
    integer: "bigint",
    real: "double precision",
    boolean: "boolean",
    text: "text",
  },
  mysql: {
    integer: "bigint",
    real: "double",
    boolean: "tinyint(1)",
    text: "text",
  },
  sqlite: {
    integer: "INTEGER",
    real: "REAL",
    boolean: "INTEGER",
    text: "TEXT",
  },
  clickhouse: {
    integer: "Int64",
    real: "Float64",
    boolean: "Bool",
    text: "String",
  },
};

export function sqlTypeFor(engine: EngineId, inferred: InferredType): string {
  return TYPE_MAP[engine][inferred];
}

// Identifier quoting per engine — used by CREATE TABLE / INSERT.
export function quoteIdent(engine: EngineId, name: string): string {
  switch (engine) {
    case "mysql":
      return `\`${name.replace(/`/g, "``")}\``;
    case "postgres":
    case "pglite":
    case "clickhouse":
    case "sqlite":
      return `"${name.replace(/"/g, '""')}"`;
  }
}
