import { describe, it, expect, vi } from "vitest";
import { ConnectionManager } from "./manager";
import { DriverError, type DatabaseDriver, type Session } from "../drivers/types";

function fakeDriver(): DatabaseDriver {
  return {
    capabilities: { editRows: false, cancelQuery: false, transactions: false, multipleSchemas: true },
    connect: vi.fn(async () => ({ id: "live" }) as Session),
    query: vi.fn(async () => ({ columns: [], rows: [], page: 0, pageSize: 0 })),
    introspect: async () => {
      throw DriverError.notImplemented("introspect");
    },
    buildEditStatement: () => {
      throw DriverError.notImplemented("buildEditStatement");
    },
    cancel: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  };
}

describe("ConnectionManager", () => {
  it("opens once and reuses the session for the same profile", async () => {
    const driver = fakeDriver();
    const mgr = new ConnectionManager(
      () => driver,
      async () => "pw",
      (id) => ({ id, name: id, engine: "postgres" }),
    );
    const s1 = await mgr.get("p1");
    const s2 = await mgr.get("p1");
    expect(s1).toBe(s2);
    expect(driver.connect).toHaveBeenCalledTimes(1);
  });

  it("disposes the underlying session", async () => {
    const driver = fakeDriver();
    const mgr = new ConnectionManager(
      () => driver,
      async () => undefined,
      (id) => ({ id, name: id, engine: "postgres" }),
    );
    await mgr.get("p1");
    await mgr.disconnect("p1");
    expect(driver.dispose).toHaveBeenCalledTimes(1);
    await mgr.get("p1");
    expect(driver.connect).toHaveBeenCalledTimes(2);
  });
});
