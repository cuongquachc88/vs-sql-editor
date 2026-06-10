import { describe, it, expect } from "vitest";
import { registerDriver, createDriver, hasDriver } from "./registry";
import { DriverError, type DatabaseDriver } from "./types";

const fake: DatabaseDriver = {
  capabilities: { editRows: false, cancelQuery: false, transactions: false, multipleSchemas: true },
  async connect() {
    return { id: "s" };
  },
  async query() {
    return { columns: [], rows: [], page: 0, pageSize: 0 };
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

describe("registry", () => {
  it("creates a registered driver", () => {
    registerDriver("postgres", () => fake);
    expect(hasDriver("postgres")).toBe(true);
    expect(createDriver("postgres")).toBe(fake);
  });

  it("throws for an unknown engine", () => {
    expect(() => createDriver("mysql")).toThrowError(/no driver registered/i);
  });
});
