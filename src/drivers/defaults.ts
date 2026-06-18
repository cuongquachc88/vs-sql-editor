import type { EngineId } from "./types";

export const DEFAULT_PORT: Partial<Record<EngineId, number>> = {
  postgres: 5432,
  mysql: 3306,
  clickhouse: 8123,
};

export const ENGINE_IDS: readonly EngineId[] = [
  "postgres",
  "mysql",
  "sqlite",
  "pglite",
  "clickhouse",
];

export const ENGINE_LABELS: Record<EngineId, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
  pglite: "PGlite (in-process Postgres)",
  clickhouse: "ClickHouse",
};

export function isFileEngine(engine: EngineId): engine is "sqlite" | "pglite" {
  return engine === "sqlite" || engine === "pglite";
}

export function isNetworkEngine(engine: EngineId): boolean {
  return engine === "postgres" || engine === "mysql" || engine === "clickhouse";
}
