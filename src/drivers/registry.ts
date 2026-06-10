import { DriverError, type DatabaseDriver, type DriverFactory, type EngineId } from "./types";

const factories = new Map<EngineId, DriverFactory>();

export function registerDriver(engine: EngineId, factory: DriverFactory): void {
  factories.set(engine, factory);
}

export function hasDriver(engine: EngineId): boolean {
  return factories.has(engine);
}

export function createDriver(engine: EngineId): DatabaseDriver {
  const factory = factories.get(engine);
  if (!factory) throw new DriverError("UNKNOWN", `No driver registered for engine "${engine}"`);
  return factory();
}
