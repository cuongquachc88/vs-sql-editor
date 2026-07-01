// End-to-end PGlite driver tests — full Postgres-compatible workflow in-process.
import { describe, it, expect, afterEach } from "vitest";
import { PgliteDriver } from "../src/drivers/pglite";
import type { Session } from "../src/drivers/types";

describe("PGlite E2E — full driver workflow", () => {
  const driver = new PgliteDriver();
  let session: Session | undefined;

  afterEach(async () => {
    if (session) {
      await driver.dispose(session);
      session = undefined;
    }
  });

  it("full CRUD lifecycle with real data", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });

    await driver.query(session, `
      create table employees (
        id bigint primary key,
        name text not null,
        salary numeric(10,2),
        active boolean default true
      )
    `);

    await driver.query(session, `
      insert into employees (id, name, salary) values
        (1, 'Ada Lovelace', 120000.00),
        (2, 'Grace Hopper', 135000.00),
        (3, 'Linus Torvalds', 98000.50)
    `);

    const rs = await driver.query(session, "select id, name from employees order by salary desc");
    expect(rs.rows[0][1]).toBe("Grace Hopper");
    expect(rs.rows[2][1]).toBe("Linus Torvalds");

    await driver.query(session, "update employees set active = false where id = 3");
    const check = await driver.query(
      session,
      "select active from employees where id = 3",
    );
    expect(check.rows[0][0]).toBe(false);
  });

  it("paging across multiple pages with hasMore flags", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    await driver.query(session, "create table nums (n int)");
    await driver.query(
      session,
      `insert into nums select g from generate_series(1, 20) g`,
    );

    const p0 = await driver.query(session, "select n from nums order by n", {
      page: 0,
      pageSize: 8,
    });
    expect(p0.rows).toHaveLength(8);
    expect(p0.hasMore).toBe(true);
    expect(p0.rows[0][0]).toBe(1);

    const p2 = await driver.query(session, "select n from nums order by n", {
      page: 2,
      pageSize: 8,
    });
    expect(p2.rows[0][0]).toBe(17);
    expect(p2.hasMore).toBe(false);
  });

  it("introspects multi-table schema with FK and views", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });

    await driver.query(session, `
      create table departments (
        dept_id int primary key,
        name text
      )
    `);
    await driver.query(session, `
      create table staff (
        staff_id int primary key,
        dept_id int references departments(dept_id),
        fullname text
      )
    `);
    await driver.query(session, `
      create view dept_summary as
        select d.name, count(s.staff_id) as headcount
        from departments d
        left join staff s on s.dept_id = d.dept_id
        group by d.name
    `);

    const model = await driver.introspect(session);
    const pub = model.databases[0].schemas.find((s) => s.name === "public")!;

    const dept = pub.tables.find((t) => t.name === "departments")!;
    expect(dept.primaryKey).toEqual(["dept_id"]);

    const staffTbl = pub.tables.find((t) => t.name === "staff")!;
    expect(staffTbl.foreignKeys).toHaveLength(1);
    expect(staffTbl.foreignKeys[0].refTable).toBe("departments");

    const view = pub.tables.find((t) => t.name === "dept_summary")!;
    expect(view.isView).toBe(true);
  });

  it("buildEditStatement with composite PK applies correctly", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    await driver.query(
      session,
      "create table line_items (order_id int, product_id int, qty int, primary key (order_id, product_id))",
    );
    await driver.query(session, "insert into line_items values (1, 42, 5)");

    const sql = driver.buildEditStatement(
      '"public"."line_items"',
      { order_id: 1, product_id: 42 },
      { qty: 10 },
    );
    expect(sql).toContain("set");
    expect(sql).toContain('"qty" = 10');
    expect(sql).toContain('"order_id" = 1');
    expect(sql).toContain('"product_id" = 42');

    await driver.query(session, sql);
    const rs = await driver.query(
      session,
      "select qty from line_items where order_id = 1 and product_id = 42",
    );
    expect(rs.rows[0][0]).toBe(10);
  });

  it("handles NULL columns in query results", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    await driver.query(session, "create table t (a int, b text)");
    await driver.query(session, "insert into t values (1, null)");
    const rs = await driver.query(session, "select a, b from t");
    expect(rs.rows[0][0]).toBe(1);
    expect(rs.rows[0][1]).toBeNull();
  });

  it("query error is wrapped as DriverError QUERY_FAILED", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    await expect(
      driver.query(session, "select * from does_not_exist"),
    ).rejects.toMatchObject({ code: "QUERY_FAILED" });
  });

  it("supports multiple schemas and isolates tables per schema", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    await driver.query(session, "create schema analytics");
    await driver.query(session, "create table public.events (id int)");
    await driver.query(session, "create table analytics.events (id int)");

    const model = await driver.introspect(session);
    const pub = model.databases[0].schemas.find((s) => s.name === "public")!;
    const ana = model.databases[0].schemas.find((s) => s.name === "analytics")!;

    expect(pub.tables.some((t) => t.name === "events")).toBe(true);
    expect(ana.tables.some((t) => t.name === "events")).toBe(true);
  });

  it("CTE queries are paged correctly", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    const rs = await driver.query(
      session,
      "with series as (select g from generate_series(1, 10) g) select g from series order by g",
      { page: 0, pageSize: 4 },
    );
    expect(rs.rows).toHaveLength(4);
    expect(rs.hasMore).toBe(true);
    expect(rs.rows[0][0]).toBe(1);
  });
});
