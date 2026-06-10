import { registerDriver } from "./registry";
import { PostgresDriver } from "./postgres";

export function registerBuiltInDrivers(): void {
  registerDriver("postgres", () => new PostgresDriver());
}
