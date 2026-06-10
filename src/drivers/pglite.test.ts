import { describe, it, expect, afterEach } from "vitest";
import { PgliteDriver } from "./pglite";
import type { Session } from "./types";

// PGlite runs fully in-process (WASM), so these are real, always-on tests.
describe("PgliteDriver", () => {
  const driver = new PgliteDriver();
  let session: Session | undefined;

  afterEach(async () => {
    if (session) await driver.dispose(session);
    session = undefined;
  });

  it("advertises capabilities", () => {
    expect(driver.capabilities).toEqual({
      editRows: true,
      cancelQuery: false,
      transactions: true,
      multipleSchemas: true,
    });
  });

  it("connects in-memory and runs a SELECT with array rows", async () => {
    session = await driver.connect({ id: "m", name: "mem", engine: "pglite" });
    const rs = await driver.query(session, "select 1 as one, 'x' as label");
    expect(rs.columns.map((c) => c.name)).toEqual(["one", "label"]);
    expect(rs.rows).toEqual([[1, "x"]]);
  });

  it("applies pageSize as LIMIT and reports hasMore", async () => {
    session = await driver.connect({ id: "m", name: "mem", engine: "pglite" });
    const rs = await driver.query(session, "select g from generate_series(1, 10) g", {
      page: 0,
      pageSize: 3,
    });
    expect(rs.rows.length).toBe(3);
    expect(rs.hasMore).toBe(true);
  });

  it("wraps a bad query as a DriverError", async () => {
    session = await driver.connect({ id: "m", name: "mem", engine: "pglite" });
    await expect(driver.query(session, "select * from nope_no_table")).rejects.toMatchObject({
      code: "QUERY_FAILED",
    });
  });

  it("persists data within a session across statements", async () => {
    session = await driver.connect({ id: "m", name: "mem", engine: "pglite" });
    await driver.query(session, "create table t (id int)");
    await driver.query(session, "insert into t values (7), (8)");
    const rs = await driver.query(session, "select id from t order by id");
    expect(rs.rows).toEqual([[7], [8]]);
  });
});
