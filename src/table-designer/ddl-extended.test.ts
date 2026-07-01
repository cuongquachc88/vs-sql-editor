// Extended DDL tests covering multi-engine ALTER TABLE, FK/index/check diffs,
// and edge cases not covered in ddl.test.ts.
import { describe, it, expect } from "vitest";
import { generateCreateTable, generateAlterTable } from "./ddl";
import type { TableSchema } from "./model";

const base = (overrides: Partial<TableSchema> = {}): TableSchema => ({
  schema: "public",
  name: "item",
  columns: [
    { name: "id", type: "bigint", nullable: false, isPrimary: true },
    { name: "label", type: "text", nullable: true, isPrimary: false },
  ],
  foreignKeys: [],
  indexes: [],
  checks: [],
  ...overrides,
});

// ─── CREATE TABLE ────────────────────────────────────────────────────────────

describe("generateCreateTable — additional engines", () => {
  it("PGlite: same as Postgres (double-quotes, schema-qualified)", () => {
    const sql = generateCreateTable("pglite", base()).join(";\n");
    expect(sql).toContain(`CREATE TABLE "public"."item"`);
    expect(sql).toContain('"id" bigint NOT NULL PRIMARY KEY');
  });

  it("MySQL: no schema qualifier, backtick identifiers", () => {
    const sql = generateCreateTable("mysql", base()).join(";\n");
    expect(sql).toContain("CREATE TABLE `item`");
    expect(sql).not.toContain("`public`");
    expect(sql).toContain("`id` bigint NOT NULL PRIMARY KEY");
  });

  it("MySQL: inline column COMMENT when provided", () => {
    const t = base({
      columns: [
        { name: "id", type: "bigint", nullable: false, isPrimary: true },
        { name: "note", type: "text", nullable: true, isPrimary: false, comment: "user's note" },
      ],
    });
    const sql = generateCreateTable("mysql", t).join(";\n");
    expect(sql).toContain("COMMENT 'user''s note'");
  });

  it("SQLite: no schema qualifier, double-quotes", () => {
    const sql = generateCreateTable("sqlite", base()).join(";\n");
    expect(sql).toContain(`CREATE TABLE "item"`);
    expect(sql).not.toContain('"public"');
  });

  it("ClickHouse: no FK inside CREATE (FKs skipped)", () => {
    const t = base({
      foreignKeys: [
        { columns: ["cat_id"], refTable: "category", refColumns: ["id"] },
      ],
    });
    const sql = generateCreateTable("clickhouse", t).join(";\n");
    expect(sql).not.toContain("FOREIGN KEY");
    expect(sql).toContain("ENGINE = MergeTree()");
  });

  it("ClickHouse: composite PK in ORDER BY", () => {
    const t = base({
      columns: [
        { name: "a", type: "UInt64", nullable: false, isPrimary: true },
        { name: "b", type: "UInt64", nullable: false, isPrimary: true },
      ],
    });
    const sql = generateCreateTable("clickhouse", t).join(";\n");
    expect(sql).toContain(`ORDER BY ("a", "b")`);
  });

  it("Postgres: unique index emits UNIQUE INDEX statement", () => {
    const t = base({
      indexes: [{ columns: ["label"], unique: true }],
    });
    const stmts = generateCreateTable("postgres", t);
    expect(stmts.some((s) => s.includes("UNIQUE INDEX"))).toBe(true);
  });

  it("Postgres: column with DEFAULT included in column def", () => {
    const t = base({
      columns: [
        { name: "id", type: "bigint", nullable: false, isPrimary: true },
        { name: "status", type: "text", nullable: false, isPrimary: false, default: "'active'" },
      ],
    });
    const sql = generateCreateTable("postgres", t).join(";\n");
    expect(sql).toContain(`DEFAULT 'active'`);
  });
});

// ─── ALTER TABLE — MySQL ──────────────────────────────────────────────────────

describe("generateAlterTable — MySQL", () => {
  it("uses MODIFY COLUMN for type change (not ALTER COLUMN)", () => {
    const o = base();
    const n = base({
      columns: [
        { name: "id", type: "bigint", nullable: false, isPrimary: true },
        { name: "label", type: "varchar(255)", nullable: true, isPrimary: false },
      ],
    });
    const sql = generateAlterTable("mysql", o, n).join(";\n");
    expect(sql).toContain("MODIFY COLUMN");
    expect(sql).not.toContain("ALTER COLUMN");
  });

  it("uses RENAME TABLE for table rename", () => {
    const o = base({ name: "item_old" });
    const n = base({ name: "item" });
    const sql = generateAlterTable("mysql", o, n).join(";\n");
    expect(sql).toContain("RENAME TABLE");
  });

  it("drops index with ON <table> clause", () => {
    const o = base({ indexes: [{ name: "idx_label", columns: ["label"], unique: false }] });
    const n = base();
    const sql = generateAlterTable("mysql", o, n).join(";\n");
    expect(sql).toMatch(/DROP INDEX `idx_label` ON `item`/);
  });
});

// ─── ALTER TABLE — SQLite ─────────────────────────────────────────────────────

describe("generateAlterTable — SQLite", () => {
  it("emits a comment instead of ALTER COLUMN TYPE", () => {
    const o = base();
    const n = base({
      columns: [
        { name: "id", type: "INTEGER", nullable: false, isPrimary: true },
        { name: "label", type: "BLOB", nullable: true, isPrimary: false },
      ],
    });
    const sql = generateAlterTable("sqlite", o, n).join(";\n");
    expect(sql).toMatch(/-- SQLite does not support altering column type/);
  });

  it("RENAME uses ALTER TABLE … RENAME TO", () => {
    const o = base({ name: "old_name" });
    const n = base({ name: "item" });
    const sql = generateAlterTable("sqlite", o, n).join(";\n");
    expect(sql).toContain("RENAME TO");
    expect(sql).not.toContain("RENAME TABLE");
  });
});

// ─── ALTER TABLE — ClickHouse ─────────────────────────────────────────────────

describe("generateAlterTable — ClickHouse", () => {
  it("uses MODIFY COLUMN for type change", () => {
    const o = base();
    const n = base({
      columns: [
        { name: "id", type: "UInt64", nullable: false, isPrimary: true },
        { name: "label", type: "String", nullable: true, isPrimary: false },
      ],
    });
    const sql = generateAlterTable("clickhouse", o, n).join(";\n");
    expect(sql).toContain("MODIFY COLUMN");
  });

  it("uses RENAME TABLE for table rename", () => {
    const o = base({ schema: "default", name: "item_v1" });
    const n = base({ schema: "default", name: "item_v2" });
    const sql = generateAlterTable("clickhouse", o, n).join(";\n");
    expect(sql).toContain("RENAME TABLE");
  });
});

// ─── ALTER TABLE — FK / index / check diffs ───────────────────────────────────

describe("generateAlterTable — constraint diffs (Postgres)", () => {
  it("adds a new FK when not present in old schema", () => {
    const o = base();
    const n = base({
      foreignKeys: [
        { name: "fk_cat", columns: ["cat_id"], refTable: "category", refColumns: ["id"] },
      ],
      columns: [
        ...base().columns,
        { name: "cat_id", type: "bigint", nullable: true, isPrimary: false },
      ],
    });
    const sql = generateAlterTable("postgres", o, n).join(";\n");
    expect(sql).toContain("ADD CONSTRAINT");
    expect(sql).toContain("FOREIGN KEY");
  });

  it("drops a named FK removed from new schema", () => {
    const o = base({
      foreignKeys: [
        { name: "fk_cat", columns: ["cat_id"], refTable: "category", refColumns: ["id"] },
      ],
    });
    const n = base();
    const sql = generateAlterTable("postgres", o, n).join(";\n");
    expect(sql).toContain("DROP CONSTRAINT");
    expect(sql).toContain('"fk_cat"');
  });

  it("adds a new index when not in old schema", () => {
    const o = base();
    const n = base({ indexes: [{ columns: ["label"], unique: false }] });
    const sql = generateAlterTable("postgres", o, n).join(";\n");
    expect(sql).toContain("CREATE INDEX");
    expect(sql).toContain('"label"');
  });

  it("drops a named index removed from new schema", () => {
    const o = base({ indexes: [{ name: "idx_item_label", columns: ["label"], unique: false }] });
    const n = base();
    const sql = generateAlterTable("postgres", o, n).join(";\n");
    expect(sql).toContain("DROP INDEX");
    expect(sql).toContain('"idx_item_label"');
  });

  it("adds a new check constraint", () => {
    const o = base();
    const n = base({ checks: [{ name: "ck_id_pos", expression: "id > 0" }] });
    const sql = generateAlterTable("postgres", o, n).join(";\n");
    expect(sql).toContain("ADD");
    expect(sql).toContain("CHECK (id > 0)");
  });

  it("drops a named check constraint removed from new schema", () => {
    const o = base({ checks: [{ name: "ck_id_pos", expression: "id > 0" }] });
    const n = base();
    const sql = generateAlterTable("postgres", o, n).join(";\n");
    expect(sql).toContain("DROP CONSTRAINT");
    expect(sql).toContain('"ck_id_pos"');
  });

  it("emits no statements when old and new are identical", () => {
    const t = base();
    expect(generateAlterTable("postgres", t, { ...t })).toEqual([]);
  });
});
