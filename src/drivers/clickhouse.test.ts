import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ClickhouseDriver } from "./clickhouse";
import type { Session } from "./types";

const url = process.env.TEST_CLICKHOUSE_URL; // e.g. http://default:@localhost:58123/default
const maybe = url ? describe : describe.skip;

maybe("ClickhouseDriver (integration)", () => {
  const driver = new ClickhouseDriver();
  let session: Session;

  beforeAll(async () => {
    const u = new URL(url!);
    session = await driver.connect(
      {
        id: "t",
        name: "t",
        engine: "clickhouse",
        host: u.hostname,
        port: Number(u.port),
        database: u.pathname.slice(1) || "default",
        user: u.username || "default",
      },
      decodeURIComponent(u.password),
    );
  });

  afterAll(async () => {
    if (session) await driver.dispose(session);
  });

  it("advertises capabilities (no row editing)", () => {
    expect(driver.capabilities).toEqual({
      editRows: false,
      cancelQuery: false,
      transactions: false,
      multipleSchemas: true,
    });
  });

  it("runs a SELECT and returns typed columns", async () => {
    const rs = await driver.query(session, "select 1 as one, 'x' as label");
    expect(rs.columns.map((c) => c.name)).toEqual(["one", "label"]);
    expect(rs.rows[0][1]).toBe("x");
  });

  it("applies pageSize as LIMIT and reports hasMore", async () => {
    const rs = await driver.query(session, "select number from numbers(10)", {
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
