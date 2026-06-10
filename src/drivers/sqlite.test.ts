import { describe, it, expect, afterEach } from "vitest";
import { SqliteDriver } from "./sqlite";
import type { Session } from "./types";

// sql.js runs fully in-process (WASM), so these are real, always-on tests.
describe("SqliteDriver", () => {
  const driver = new SqliteDriver();
  let session: Session | undefined;

  afterEach(async () => {
    if (session) await driver.dispose(session);
    session = undefined;
  });

  it("advertises capabilities (single schema)", () => {
    expect(driver.capabilities).toEqual({
      editRows: true,
      cancelQuery: false,
      transactions: true,
      multipleSchemas: false,
    });
  });

  it("opens an in-memory db and runs a SELECT", async () => {
    session = await driver.connect({ id: "m", name: "mem", engine: "sqlite" });
    const rs = await driver.query(session, "select 1 as one, 'x' as label");
    expect(rs.columns.map((c) => c.name)).toEqual(["one", "label"]);
    expect(rs.rows).toEqual([[1, "x"]]);
  });

  it("persists writes within a session and pages results", async () => {
    session = await driver.connect({ id: "m", name: "mem", engine: "sqlite" });
    await driver.query(session, "create table t (id integer)");
    await driver.query(session, "insert into t values (1),(2),(3),(4),(5)");
    const rs = await driver.query(session, "select id from t order by id", { page: 0, pageSize: 2 });
    expect(rs.rows).toEqual([[1], [2]]);
    expect(rs.hasMore).toBe(true);
  });

  it("wraps a bad query as a DriverError", async () => {
    session = await driver.connect({ id: "m", name: "mem", engine: "sqlite" });
    await expect(driver.query(session, "select * from nope_no_table")).rejects.toMatchObject({
      code: "QUERY_FAILED",
    });
  });
});
