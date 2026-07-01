// E2E paging tests — applySelectPaging output executed against real in-process DBs.
// Tests the full chain: paging wrapper → driver → actual SQL engine.
import { describe, it, expect, afterEach } from "vitest";
import { PgliteDriver } from "../src/drivers/pglite";
import { SqliteDriver } from "../src/drivers/sqlite";
import { applySelectPaging } from "../src/drivers/paging";
import type { Session } from "../src/drivers/types";

// ─── PGlite ───────────────────────────────────────────────────────────────────

describe("paging E2E — PGlite", () => {
  const driver = new PgliteDriver();
  let session: Session | undefined;

  afterEach(async () => {
    if (session) { await driver.dispose(session); session = undefined; }
  });

  it("SELECT paging wrapper is valid SQL the engine accepts", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    await driver.query(session, "create table nums (n int)");
    await driver.query(session, "insert into nums select g from generate_series(1,25) g");

    // Manually apply paging and run the resulting SQL directly.
    const paged = applySelectPaging("select n from nums order by n", 1, 10);
    const res = await driver.query(session, paged, { page: 0, pageSize: 9999 });
    // page 1 of 10 → offset 10 → rows 11..20
    expect(res.rows).toHaveLength(10);
    expect(res.rows[0][0]).toBe(11);
    expect(res.rows[9][0]).toBe(20);
  });

  it("read-only CTE is paged (wrapped in subquery)", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    const cte = "with s as (select g as n from generate_series(1,15) g) select n from s order by n";
    const rs = await driver.query(session, cte, { page: 1, pageSize: 5 });
    expect(rs.rows).toHaveLength(5);
    expect(rs.rows[0][0]).toBe(6);
    expect(rs.hasMore).toBe(true);
  });

  it("DML CTE (WITH ... INSERT) is NOT wrapped — passes through as-is", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    await driver.query(session, "create table targets (x int)");

    const dmlCte = "with v(x) as (values (1), (2)) insert into targets select x from v";
    // applySelectPaging must leave DML CTEs unchanged
    const paged = applySelectPaging(dmlCte, 0, 10);
    expect(paged).toBe(dmlCte);

    // And it must execute cleanly as DML (rowCount, not rows)
    const rs = await driver.query(session, dmlCte);
    expect(rs.rowCount).toBe(2);
    const check = await driver.query(session, "select x from targets order by x");
    expect(check.rows.map((r) => r[0])).toEqual([1, 2]);
  });

  it("trailing semicolons are stripped before wrapping", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    const paged = applySelectPaging("select 42 as n;", 0, 5);
    const rs = await driver.query(session, paged, { page: 0, pageSize: 9999 });
    expect(rs.rows[0][0]).toBe(42);
  });

  it("last page of paged results has hasMore=false", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    await driver.query(session, "create table small (n int)");
    await driver.query(session, "insert into small select g from generate_series(1,7) g");

    const p1 = await driver.query(session, "select n from small order by n", { page: 1, pageSize: 5 });
    expect(p1.rows).toHaveLength(2);
    expect(p1.hasMore).toBe(false);
  });
});

// ─── SQLite ───────────────────────────────────────────────────────────────────

describe("paging E2E — SQLite", () => {
  const driver = new SqliteDriver();
  let session: Session | undefined;

  afterEach(async () => {
    if (session) { await driver.dispose(session); session = undefined; }
  });

  it("SELECT paging wraps correctly for SQLite dialect", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "sqlite" });
    await driver.query(session, "create table t (n integer)");
    for (let i = 1; i <= 15; i++) {
      await driver.query(session, `insert into t values (${i})`);
    }

    const rs = await driver.query(session, "select n from t order by n", { page: 2, pageSize: 4 });
    expect(rs.rows.map((r) => r[0])).toEqual([9, 10, 11, 12]);
    expect(rs.hasMore).toBe(true);
  });

  it("INSERT passes through paging unchanged", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "sqlite" });
    await driver.query(session, "create table t (n integer)");
    const insert = "insert into t values (99)";
    const passed = applySelectPaging(insert, 0, 10);
    expect(passed).toBe(insert);
    await driver.query(session, insert);
    const rs = await driver.query(session, "select n from t");
    expect(rs.rows[0][0]).toBe(99);
  });
});
