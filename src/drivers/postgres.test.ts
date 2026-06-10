import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgresDriver } from "./postgres";
import type { Session } from "./types";

const url = process.env.TEST_PG_URL; // e.g. postgres://postgres:test@localhost:55432/testdb
const maybe = url ? describe : describe.skip;

maybe("PostgresDriver (integration)", () => {
  const driver = new PostgresDriver();
  let session: Session;

  beforeAll(async () => {
    const u = new URL(url!);
    session = await driver.connect(
      {
        id: "t",
        name: "t",
        engine: "postgres",
        host: u.hostname,
        port: Number(u.port),
        database: u.pathname.slice(1),
        user: u.username,
      },
      decodeURIComponent(u.password),
    );
  });

  afterAll(async () => {
    if (session) await driver.dispose(session);
  });

  it("advertises capabilities", () => {
    expect(driver.capabilities).toEqual({
      editRows: true,
      cancelQuery: true,
      transactions: true,
      multipleSchemas: true,
    });
  });

  it("runs a SELECT and returns typed columns", async () => {
    const rs = await driver.query(session, "select 1 as one, 'x'::text as label");
    expect(rs.columns.map((c) => c.name)).toEqual(["one", "label"]);
    expect(rs.rows).toEqual([[1, "x"]]);
  });

  it("applies pageSize as LIMIT and reports hasMore", async () => {
    const rs = await driver.query(session, "select g from generate_series(1, 10) g", {
      page: 0,
      pageSize: 3,
    });
    expect(rs.rows.length).toBe(3);
    expect(rs.hasMore).toBe(true);
  });

  it("wraps a bad query as a DriverError", async () => {
    await expect(driver.query(session, "select * from nope_no_table")).rejects.toMatchObject({
      code: "QUERY_FAILED",
    });
  });
});
