import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MysqlDriver } from "./mysql";
import type { Session } from "./types";

const url = process.env.TEST_MYSQL_URL; // e.g. mysql://root:test@localhost:53306/testdb
const maybe = url ? describe : describe.skip;

maybe("MysqlDriver (integration)", () => {
  const driver = new MysqlDriver();
  let session: Session;

  beforeAll(async () => {
    const u = new URL(url!);
    session = await driver.connect(
      {
        id: "t",
        name: "t",
        engine: "mysql",
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

  it("runs a SELECT and returns array rows", async () => {
    const rs = await driver.query(session, "select 1 as one, 'x' as label");
    expect(rs.columns.map((c) => c.name)).toEqual(["one", "label"]);
    expect(rs.rows).toEqual([[1, "x"]]);
  });

  it("applies pageSize as LIMIT and reports hasMore", async () => {
    const rs = await driver.query(
      session,
      "select 1 union all select 2 union all select 3 union all select 4",
      { page: 0, pageSize: 2 },
    );
    expect(rs.rows.length).toBe(2);
    expect(rs.hasMore).toBe(true);
  });

  it("wraps a bad query as a DriverError", async () => {
    await expect(driver.query(session, "select * from nope_no_table")).rejects.toMatchObject({
      code: "QUERY_FAILED",
    });
  });
});
