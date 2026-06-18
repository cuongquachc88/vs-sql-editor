import { describe, it, expect, vi } from "vitest";
import { runConnectionTest } from "./test";
import type { DatabaseDriver, Session } from "../../drivers/types";

function fakeDriver(overrides: Partial<DatabaseDriver> = {}): DatabaseDriver {
  return {
    capabilities: {
      editRows: false,
      cancelQuery: false,
      transactions: false,
      multipleSchemas: false,
    },
    connect: vi.fn(async () => ({ id: "s1" }) as Session),
    query: vi.fn(),
    introspect: vi.fn(),
    buildEditStatement: vi.fn(() => ""),
    cancel: vi.fn(),
    dispose: vi.fn(async () => undefined),
    ...overrides,
  } as DatabaseDriver;
}

describe("runConnectionTest", () => {
  it("returns ok and disposes the session on success", async () => {
    const driver = fakeDriver();
    const result = await runConnectionTest(
      { name: "x", engine: "postgres", host: "h" },
      "pw",
      () => driver,
    );
    expect(result).toEqual({ ok: true });
    expect(driver.connect).toHaveBeenCalledOnce();
    expect(driver.dispose).toHaveBeenCalledOnce();
  });

  it("returns an error and does not dispose when connect throws", async () => {
    const driver = fakeDriver({
      connect: vi.fn(async () => {
        throw new Error("bad password");
      }),
    });
    const result = await runConnectionTest(
      { name: "x", engine: "postgres" },
      "wrong",
      () => driver,
    );
    expect(result).toEqual({ ok: false, error: "bad password" });
    expect(driver.dispose).not.toHaveBeenCalled();
  });

  it("returns an error if the driver factory itself throws", async () => {
    const result = await runConnectionTest(
      { name: "x", engine: "postgres" },
      undefined,
      () => {
        throw new Error("no driver registered");
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no driver/);
  });

  it("swallows disposal errors so the success result still surfaces", async () => {
    const driver = fakeDriver({
      dispose: vi.fn(async () => {
        throw new Error("dispose blew up");
      }),
    });
    const result = await runConnectionTest({ name: "x", engine: "postgres" }, "p", () => driver);
    expect(result).toEqual({ ok: true });
  });
});
