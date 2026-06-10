import { describe, it, expect } from "vitest";
import { DriverError, type DatabaseDriver, type ResultSet } from "./types";

describe("DriverError", () => {
  it("normalizes an unknown error", () => {
    const e = DriverError.from(new Error("boom"));
    expect(e.code).toBe("UNKNOWN");
    expect(e.message).toBe("boom");
  });

  it("preserves a provided code and detail", () => {
    const e = new DriverError("CONN_REFUSED", "cannot connect", "ECONNREFUSED 5432");
    expect(e.code).toBe("CONN_REFUSED");
    expect(e.detail).toBe("ECONNREFUSED 5432");
  });
});

describe("type contract (compile-time)", () => {
  it("a minimal driver satisfies the interface", () => {
    const rs: ResultSet = {
      columns: [{ name: "id", type: "int4" }],
      rows: [[1]],
      page: 0,
      pageSize: 1,
    };
    const fake: DatabaseDriver = {
      capabilities: { editRows: false, cancelQuery: false, transactions: false, multipleSchemas: true },
      async connect() {
        return { id: "s1" };
      },
      async query() {
        return rs;
      },
      async introspect() {
        throw DriverError.notImplemented("introspect");
      },
      buildEditStatement() {
        throw DriverError.notImplemented("buildEditStatement");
      },
      async cancel() {},
      async dispose() {},
    };
    expect(fake.capabilities.multipleSchemas).toBe(true);
  });
});
