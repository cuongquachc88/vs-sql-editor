import { registerDriver } from "./registry";
import { PostgresDriver } from "./postgres";
import { MysqlDriver } from "./mysql";
import { SqliteDriver } from "./sqlite";
import { PgliteDriver } from "./pglite";
import { ClickhouseDriver } from "./clickhouse";

export function registerBuiltInDrivers(): void {
  registerDriver("postgres", () => new PostgresDriver());
  registerDriver("mysql", () => new MysqlDriver());
  registerDriver("sqlite", () => new SqliteDriver());
  registerDriver("pglite", () => new PgliteDriver());
  registerDriver("clickhouse", () => new ClickhouseDriver());
}
