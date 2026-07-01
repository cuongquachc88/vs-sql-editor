// E2E table-designer tests — generateCreateTable / generateAlterTable output
// executed against real in-process databases (PGlite + SQLite).
import { describe, it, expect, afterEach } from "vitest";
import { PgliteDriver } from "../src/drivers/pglite";
import { SqliteDriver } from "../src/drivers/sqlite";
import { generateCreateTable, generateAlterTable } from "../src/table-designer/ddl";
import type { Session } from "../src/drivers/types";
import type { TableSchema } from "../src/table-designer/model";

function base(overrides: Partial<TableSchema> = {}): TableSchema {
  return {
    schema: "public",
    name: "products",
    columns: [
      { name: "id", type: "bigint", nullable: false, isPrimary: true },
      { name: "name", type: "text", nullable: false, isPrimary: false },
      { name: "price", type: "numeric(10,2)", nullable: true, isPrimary: false },
    ],
    foreignKeys: [],
    indexes: [],
    checks: [],
    ...overrides,
  };
}

// ─── PGlite ───────────────────────────────────────────────────────────────────

describe("table-designer E2E — PGlite CREATE TABLE", () => {
  const driver = new PgliteDriver();
  let session: Session | undefined;

  afterEach(async () => {
    if (session) { await driver.dispose(session); session = undefined; }
  });

  it("generates valid CREATE TABLE DDL that PGlite accepts", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    const stmts = generateCreateTable("pglite", base());
    for (const sql of stmts) await driver.query(session, sql);

    const model = await driver.introspect(session);
    const pub = model.databases[0].schemas.find((s) => s.name === "public")!;
    const tbl = pub.tables.find((t) => t.name === "products")!;
    expect(tbl).toBeDefined();
    expect(tbl.primaryKey).toEqual(["id"]);
    const cols = tbl.columns.map((c) => c.name);
    expect(cols).toContain("name");
    expect(cols).toContain("price");
  });

  it("generates CREATE INDEX that PGlite accepts", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    const schema = base({
      indexes: [{ name: "idx_name", columns: ["name"], unique: true }],
    });
    const stmts = generateCreateTable("pglite", schema);
    for (const sql of stmts) await driver.query(session, sql);

    // Verify table exists and index works (unique violation)
    await driver.query(session, "insert into products (id, name) values (1, 'Alpha')");
    await expect(
      driver.query(session, "insert into products (id, name) values (2, 'Alpha')"),
    ).rejects.toMatchObject({ code: "QUERY_FAILED" });
  });

  it("generates FK clause that PGlite enforces", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    await driver.query(session, "create table categories (id bigint primary key)");

    const schema = base({
      columns: [
        { name: "id", type: "bigint", nullable: false, isPrimary: true },
        { name: "cat_id", type: "bigint", nullable: true, isPrimary: false },
        { name: "name", type: "text", nullable: false, isPrimary: false },
      ],
      foreignKeys: [
        {
          columns: ["cat_id"],
          refTable: "categories",
          refColumns: ["id"],
          onDelete: "SET NULL",
        },
      ],
    });
    const stmts = generateCreateTable("pglite", schema);
    for (const sql of stmts) await driver.query(session, sql);

    await driver.query(session, "insert into categories values (10)");
    await driver.query(session, "insert into products (id, cat_id, name) values (1, 10, 'x')");

    // FK violation: cat_id 99 does not exist
    await expect(
      driver.query(session, "insert into products (id, cat_id, name) values (2, 99, 'y')"),
    ).rejects.toMatchObject({ code: "QUERY_FAILED" });
  });

  it("generateAlterTable adds column — DDL executes and introspects", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    const before = base();
    const after = base({
      columns: [
        ...before.columns,
        { name: "active", type: "boolean", nullable: true, isPrimary: false, default: "true" },
      ],
    });

    for (const sql of generateCreateTable("pglite", before)) await driver.query(session, sql);
    const diff = generateAlterTable("pglite", before, after);
    expect(diff.length).toBeGreaterThan(0);
    for (const sql of diff) await driver.query(session, sql);

    const model = await driver.introspect(session);
    const tbl = model.databases[0].schemas
      .find((s) => s.name === "public")!.tables
      .find((t) => t.name === "products")!;
    expect(tbl.columns.some((c) => c.name === "active")).toBe(true);
  });

  it("generateAlterTable with no changes produces empty diff", () => {
    const schema = base();
    const diff = generateAlterTable("pglite", schema, schema);
    expect(diff).toHaveLength(0);
  });
});

// ─── SQLite ───────────────────────────────────────────────────────────────────

describe("table-designer E2E — SQLite CREATE TABLE", () => {
  const driver = new SqliteDriver();
  let session: Session | undefined;

  afterEach(async () => {
    if (session) { await driver.dispose(session); session = undefined; }
  });

  it("generates valid SQLite CREATE TABLE DDL", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "sqlite" });
    const schema: TableSchema = {
      schema: "main",
      name: "items",
      columns: [
        { name: "id", type: "INTEGER", nullable: false, isPrimary: true },
        { name: "label", type: "TEXT", nullable: false, isPrimary: false },
        { name: "qty", type: "INTEGER", nullable: true, isPrimary: false },
      ],
      foreignKeys: [],
      indexes: [],
      checks: [],
    };
    const stmts = generateCreateTable("sqlite", schema);
    for (const sql of stmts) await driver.query(session, sql);

    const model = await driver.introspect(session);
    const tbl = model.databases[0].schemas[0].tables.find((t) => t.name === "items")!;
    expect(tbl).toBeDefined();
    expect(tbl.primaryKey).toEqual(["id"]);
  });

  it("SQLite CHECK constraint is enforced at engine level", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "sqlite" });
    const schema: TableSchema = {
      schema: "main",
      name: "stock",
      columns: [
        { name: "id", type: "INTEGER", nullable: false, isPrimary: true },
        { name: "qty", type: "INTEGER", nullable: false, isPrimary: false },
      ],
      foreignKeys: [],
      indexes: [],
      checks: [{ expression: "qty >= 0" }],
    };
    const stmts = generateCreateTable("sqlite", schema);
    for (const sql of stmts) await driver.query(session, sql);

    await driver.query(session, "insert into stock values (1, 10)");
    await expect(
      driver.query(session, "insert into stock values (2, -1)"),
    ).rejects.toMatchObject({ code: "QUERY_FAILED" });
  });
});
