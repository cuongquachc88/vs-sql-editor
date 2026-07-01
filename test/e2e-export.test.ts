// E2E export tests — real DB query → toCsv / toJson roundtrip.
// Validates that types that survive the DB round-trip are serialized correctly.
import { describe, it, expect, afterEach } from "vitest";
import { PgliteDriver } from "../src/drivers/pglite";
import { SqliteDriver } from "../src/drivers/sqlite";
import { toCsv } from "../src/export/csv";
import { toJson } from "../src/export/json";
import type { Session } from "../src/drivers/types";

// ─── PGlite ───────────────────────────────────────────────────────────────────

describe("export E2E — PGlite → CSV + JSON", () => {
  const driver = new PgliteDriver();
  let session: Session | undefined;

  afterEach(async () => {
    if (session) { await driver.dispose(session); session = undefined; }
  });

  it("toCsv produces correct header and quoted values from real query", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    await driver.query(session, "create table people (id int, name text, score float8)");
    await driver.query(session, "insert into people values (1,'Ada Lovelace',9.5),(2,'Grace, the great',8.0)");

    const rs = await driver.query(session, "select id, name, score from people order by id");
    const csv = toCsv(rs);

    const lines = csv.split("\n").filter(Boolean);
    expect(lines[0]).toBe("id,name,score");
    expect(lines[1]).toBe('1,Ada Lovelace,9.5');
    // Name with comma must be quoted
    expect(lines[2]).toContain('"Grace, the great"');
  });

  it("toJson produces array of objects with correct types", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    await driver.query(session, "create table t (n int, s text, b boolean)");
    await driver.query(session, "insert into t values (42, 'hello', true)");

    const rs = await driver.query(session, "select n, s, b from t");
    const parsed = JSON.parse(toJson(rs)) as Record<string, unknown>[];

    expect(parsed).toHaveLength(1);
    expect(parsed[0].n).toBe(42);
    expect(parsed[0].s).toBe("hello");
    expect(parsed[0].b).toBe(true);
  });

  it("NULL values appear as null in JSON and empty in CSV", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    await driver.query(session, "create table nulls (a int, b text)");
    await driver.query(session, "insert into nulls values (1, null)");

    const rs = await driver.query(session, "select a, b from nulls");

    // JSON: null
    const parsed = JSON.parse(toJson(rs)) as Record<string, unknown>[];
    expect(parsed[0].b).toBeNull();

    // CSV: empty field
    const csv = toCsv(rs);
    const dataLine = csv.split("\n")[1];
    expect(dataLine).toBe("1,");
  });

  it("numeric precision survives the DB→CSV roundtrip", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    const rs = await driver.query(session, "select 3.14159::float8 as pi");
    const csv = toCsv(rs);
    expect(csv).toContain("3.14159");
  });

  it("multi-page: export covers only the current page rows", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    await driver.query(session, "create table g (n int)");
    await driver.query(session, "insert into g select i from generate_series(1,20) i");

    // Page 0 of 5
    const rs = await driver.query(session, "select n from g order by n", { page: 0, pageSize: 5 });
    const parsed = JSON.parse(toJson(rs)) as { n: number }[];
    expect(parsed).toHaveLength(5);
    expect(parsed[0].n).toBe(1);
    expect(parsed[4].n).toBe(5);
  });
});

// ─── SQLite ───────────────────────────────────────────────────────────────────

describe("export E2E — SQLite → CSV + JSON", () => {
  const driver = new SqliteDriver();
  let session: Session | undefined;

  afterEach(async () => {
    if (session) { await driver.dispose(session); session = undefined; }
  });

  it("toCsv from SQLite real query has correct headers", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "sqlite" });
    await driver.query(session, "create table t (x integer, y text)");
    await driver.query(session, "insert into t values (7, 'foo')");

    const rs = await driver.query(session, "select x, y from t");
    const csv = toCsv(rs);
    expect(csv.startsWith("x,y\n")).toBe(true);
    expect(csv).toContain("7,foo");
  });

  it("toJson from SQLite preserves integer and text types", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "sqlite" });
    await driver.query(session, "create table t (n integer, s text)");
    await driver.query(session, "insert into t values (99, 'bar')");

    const rs = await driver.query(session, "select n, s from t");
    const parsed = JSON.parse(toJson(rs)) as Record<string, unknown>[];
    expect(parsed[0].n).toBe(99);
    expect(parsed[0].s).toBe("bar");
  });
});
