import type { EngineId } from "../drivers/types";

// Build a qualified, quoted table reference for a SELECT preview, per engine.
export function qualifyTable(engine: EngineId, schema: string, table: string): string {
  switch (engine) {
    case "postgres":
    case "pglite":
      return `"${schema}"."${table}"`;
    case "mysql":
      return `\`${schema}\`.\`${table}\``;
    case "clickhouse":
      return `"${schema}"."${table}"`;
    case "sqlite":
      return `"${table}"`;
  }
}
