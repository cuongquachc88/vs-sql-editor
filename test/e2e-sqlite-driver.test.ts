// End-to-end SQLite driver tests — full CRUD + schema introspection + paging.
// These run in-process (WASM, no external service).
import { describe, it, expect, afterEach } from "vitest";
import { SqliteDriver } from "../src/drivers/sqlite";
import type { Session } from "../src/drivers/types";

describe("SQLite E2E — full driver workflow", () => {
  const driver = new SqliteDriver();
  let session: Session | undefined;

  afterEach(async () => {
    if (session) {
      await driver.dispose(session);
      session = undefined;
    }
  });

  it("creates table, inserts, reads back, and pages results", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "sqlite" });

    await driver.query(session, `
      create table products (
        id integer primary key,
        name text not null,
        price real,
        in_stock integer
      )
    `);

    // 13 rows, pageSize=5: page 0 has 5 (hasMore=true), page 2 has 3 (hasMore=false)
    for (let i = 1; i <= 13; i++) {
      await driver.query(
        session,
        `insert into products values (${i}, 'item${i}', ${i * 9.99}, ${i % 2})`,
      );
    }

    // Page 0 of 5
    const p0 = await driver.query(session, "select id, name from products order by id", {
      page: 0,
      pageSize: 5,
    });
    expect(p0.rows).toHaveLength(5);
    expect(p0.rows[0][0]).toBe(1);
    expect(p0.hasMore).toBe(true);

    // Page 2 of 5 (items 11-13, 3 rows < pageSize → hasMore=false)
    const p2 = await driver.query(session, "select id from products order by id", {
      page: 2,
      pageSize: 5,
    });
    expect(p2.rows[0][0]).toBe(11);
    expect(p2.rows).toHaveLength(3);
    expect(p2.hasMore).toBe(false);
  });

  it("introspects tables, views, and foreign keys after DDL", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "sqlite" });

    await driver.query(session, `
      create table categories (code text primary key, label text)
    `);
    await driver.query(session, `
      create table items (
        id integer primary key,
        cat text references categories(code),
        name text
      )
    `);
    await driver.query(session, `
      create view active_items as select id, name from items
    `);

    const model = await driver.introspect(session);
    const schema = model.databases[0].schemas[0];

    const cat = schema.tables.find((t) => t.name === "categories")!;
    expect(cat).toBeDefined();
    expect(cat.primaryKey).toEqual(["code"]);

    const item = schema.tables.find((t) => t.name === "items")!;
    expect(item.foreignKeys).toHaveLength(1);
    expect(item.foreignKeys[0]).toMatchObject({
      columns: ["cat"],
      refTable: "categories",
      refColumns: ["code"],
    });

    const view = schema.tables.find((t) => t.name === "active_items")!;
    expect(view.isView).toBe(true);
  });

  it("buildEditStatement generates correct UPDATE and applies it", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "sqlite" });
    await driver.query(session, "create table users (id integer primary key, email text)");
    await driver.query(session, "insert into users values (1, 'old@example.com')");

    const sql = driver.buildEditStatement('"users"', { id: 1 }, { email: "new@example.com" });
    expect(sql).toContain("update");
    expect(sql).toContain("'new@example.com'");

    await driver.query(session, sql);
    const rs = await driver.query(session, "select email from users where id = 1");
    expect(rs.rows[0][0]).toBe("new@example.com");
  });

  it("wraps query errors as DriverError with QUERY_FAILED code", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "sqlite" });
    await expect(
      driver.query(session, "select * from nonexistent_table"),
    ).rejects.toMatchObject({ code: "QUERY_FAILED" });
  });

  it("returns correct column metadata from SELECT", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "sqlite" });
    await driver.query(session, "create table t (n integer, s text, r real)");
    await driver.query(session, "insert into t values (1, 'hello', 3.14)");
    const rs = await driver.query(session, "select n, s, r from t");
    expect(rs.columns.map((c) => c.name)).toEqual(["n", "s", "r"]);
    expect(rs.rows[0]).toEqual([1, "hello", 3.14]);
  });

  it("handles transactions — all or nothing", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "sqlite" });
    await driver.query(session, "create table t (id integer primary key)");
    await driver.query(session, "begin");
    await driver.query(session, "insert into t values (1)");
    await driver.query(session, "rollback");
    const rs = await driver.query(session, "select count(*) from t");
    expect(Number(rs.rows[0][0])).toBe(0);
  });
});
