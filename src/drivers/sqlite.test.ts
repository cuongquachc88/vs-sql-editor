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

  it("introspects tables, columns and primary keys", async () => {
    session = await driver.connect({ id: "m", name: "mem", engine: "sqlite" });
    await driver.query(session, "create table person (id integer primary key, name text)");
    await driver.query(session, "create view person_v as select id from person");
    const model = await driver.introspect(session);
    const main = model.databases[0].schemas[0];
    expect(main.name).toBe("main");
    const person = main.tables.find((t) => t.name === "person")!;
    expect(person.columns.map((c) => c.name)).toEqual(["id", "name"]);
    expect(person.primaryKey).toEqual(["id"]);
    expect(main.tables.find((t) => t.name === "person_v")!.isView).toBe(true);
  });

  it("introspects foreign keys", async () => {
    session = await driver.connect({ id: "m", name: "mem", engine: "sqlite" });
    await driver.query(session, "create table country (code text primary key, name text)");
    await driver.query(
      session,
      "create table city (id integer primary key, country_code text references country(code), name text)",
    );
    const model = await driver.introspect(session);
    const city = model.databases[0].schemas[0].tables.find((t) => t.name === "city")!;
    expect(city.foreignKeys).toHaveLength(1);
    expect(city.foreignKeys[0]).toMatchObject({
      columns: ["country_code"],
      refTable: "country",
      refColumns: ["code"],
    });
  });
});
