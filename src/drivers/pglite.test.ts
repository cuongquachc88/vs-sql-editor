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

  it("returns the public schema for an empty database (no user tables)", async () => {
    session = await driver.connect({ id: "m", name: "mem", engine: "pglite" });
    const model = await driver.introspect(session);
    expect(model.databases).toHaveLength(1);
    const pub = model.databases[0].schemas.find((s) => s.name === "public");
    expect(pub).toBeDefined();
    expect(pub!.tables).toEqual([]);
  });

  it("introspects schemas, tables, columns and primary keys", async () => {
    session = await driver.connect({ id: "m", name: "mem", engine: "pglite" });
    await driver.query(session, "create table person (id int primary key, name text)");
    await driver.query(session, "create view person_v as select id from person");
    const model = await driver.introspect(session);
    const publicSchema = model.databases[0].schemas.find((s) => s.name === "public");
    expect(publicSchema).toBeDefined();
    const person = publicSchema!.tables.find((t) => t.name === "person")!;
    expect(person.columns.map((c) => c.name)).toEqual(["id", "name"]);
    expect(person.primaryKey).toEqual(["id"]);
    expect(person.isView).toBe(false);
    const view = publicSchema!.tables.find((t) => t.name === "person_v")!;
    expect(view.isView).toBe(true);
  });

  it("introspects foreign keys (composite)", async () => {
    session = await driver.connect({ id: "m", name: "mem", engine: "pglite" });
    await driver.query(session, "create table country (code text primary key, name text)");
    await driver.query(
      session,
      "create table city (id int primary key, country_code text references country(code), name text)",
    );
    const model = await driver.introspect(session);
    const pub = model.databases[0].schemas.find((s) => s.name === "public")!;
    const city = pub.tables.find((t) => t.name === "city")!;
    expect(city.foreignKeys).toHaveLength(1);
    expect(city.foreignKeys[0]).toMatchObject({
      columns: ["country_code"],
      refTable: "country",
      refColumns: ["code"],
    });
  });

  it("buildEditStatement produces an UPDATE that actually applies", async () => {
    session = await driver.connect({ id: "m", name: "mem", engine: "pglite" });
    await driver.query(session, "create table person (id int primary key, name text)");
    await driver.query(session, "insert into person values (1, 'Ada')");
    const sql = driver.buildEditStatement('"public"."person"', { id: 1 }, { name: "Grace" });
    expect(sql).toBe(`update "public"."person" set "name" = 'Grace' where "id" = 1`);
    await driver.query(session, sql);
    const rs = await driver.query(session, "select name from person where id = 1");
    expect(rs.rows).toEqual([["Grace"]]);
  });
});
