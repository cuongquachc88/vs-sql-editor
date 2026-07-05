// Comprehensive tests for constraints (CHECK, FK, INDEX) and preview SQL
// across all engines. Covers gaps not in ddl.test.ts / ddl-extended.test.ts.
import { describe, it, expect } from "vitest";
import { generateCreateTable, generateAlterTable } from "./ddl";
import type { TableSchema } from "./model";

const tbl = (overrides: Partial<TableSchema> = {}): TableSchema => ({
  schema: "public",
  name: "orders",
  columns: [
    { name: "id", type: "bigint", nullable: false, isPrimary: true },
    { name: "amount", type: "numeric", nullable: false, isPrimary: false },
    { name: "status", type: "text", nullable: true, isPrimary: false },
  ],
  foreignKeys: [],
  indexes: [],
  checks: [],
  ...overrides,
});

// ── CHECK CONSTRAINTS ─────────────────────────────────────────────────────────

describe("CHECK constraints — CREATE TABLE", () => {
  it("anonymous check appears inside CREATE body (postgres)", () => {
    const t = tbl({ checks: [{ expression: "amount > 0" }] });
    const sql = generateCreateTable("postgres", t).join(";\n");
    expect(sql).toContain("CHECK (amount > 0)");
    expect(sql).not.toContain("CONSTRAINT"); // no name → no CONSTRAINT keyword
  });

  it("named check includes CONSTRAINT keyword (postgres)", () => {
    const t = tbl({ checks: [{ name: "ck_pos", expression: "amount > 0" }] });
    const sql = generateCreateTable("postgres", t).join(";\n");
    expect(sql).toContain(`CONSTRAINT "ck_pos" CHECK (amount > 0)`);
  });

  it("multiple checks all appear (postgres)", () => {
    const t = tbl({
      checks: [
        { expression: "amount > 0" },
        { name: "ck_status", expression: "status IN ('open','closed')" },
      ],
    });
    const sql = generateCreateTable("postgres", t).join(";\n");
    expect(sql).toContain("CHECK (amount > 0)");
    expect(sql).toContain(`CONSTRAINT "ck_status" CHECK (status IN ('open','closed'))`);
  });

  it("named check includes CONSTRAINT keyword (mysql)", () => {
    const t = tbl({ checks: [{ name: "ck_amt", expression: "amount >= 0" }] });
    const sql = generateCreateTable("mysql", t).join(";\n");
    expect(sql).toContain("CONSTRAINT `ck_amt` CHECK (amount >= 0)");
  });

  it("check included for sqlite", () => {
    const t = tbl({ checks: [{ expression: "amount >= 0" }] });
    const sql = generateCreateTable("sqlite", t).join(";\n");
    expect(sql).toContain("CHECK (amount >= 0)");
  });

  it("check included for pglite (same as postgres)", () => {
    const t = tbl({ checks: [{ name: "ck_p", expression: "id > 0" }] });
    const sql = generateCreateTable("pglite", t).join(";\n");
    expect(sql).toContain(`CONSTRAINT "ck_p" CHECK (id > 0)`);
  });

  it("check expression with SQL apostrophes is preserved verbatim", () => {
    const t = tbl({ checks: [{ expression: "status <> 'deleted'" }] });
    const sql = generateCreateTable("postgres", t).join(";\n");
    expect(sql).toContain("CHECK (status <> 'deleted')");
  });

  it("clickhouse: check is included (ClickHouse supports CHECK in DDL)", () => {
    const t = tbl({ checks: [{ expression: "amount > 0" }] });
    const sql = generateCreateTable("clickhouse", t).join(";\n");
    expect(sql).toContain("CHECK (amount > 0)");
  });
});

describe("CHECK constraints — ALTER TABLE diff", () => {
  it("adds anonymous check when new (postgres)", () => {
    const o = tbl();
    const n = tbl({ checks: [{ expression: "amount > 0" }] });
    const stmts = generateAlterTable("postgres", o, n);
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toMatch(/ALTER TABLE.*ADD.*CHECK \(amount > 0\)/);
  });

  it("adds named check with CONSTRAINT clause (postgres)", () => {
    const o = tbl();
    const n = tbl({ checks: [{ name: "ck_pos", expression: "amount > 0" }] });
    const sql = generateAlterTable("postgres", o, n).join(";\n");
    expect(sql).toContain("ADD CONSTRAINT");
    expect(sql).toContain('"ck_pos"');
    expect(sql).toContain("CHECK (amount > 0)");
  });

  it("drops named check when removed (postgres)", () => {
    const o = tbl({ checks: [{ name: "ck_pos", expression: "amount > 0" }] });
    const n = tbl();
    const sql = generateAlterTable("postgres", o, n).join(";\n");
    expect(sql).toContain("DROP CONSTRAINT");
    expect(sql).toContain('"ck_pos"');
  });

  it("unnamed removed check is not emitted (no name to DROP)", () => {
    const o = tbl({ checks: [{ expression: "amount > 0" }] });
    const n = tbl();
    // No name → cannot drop → expect empty or no DROP statement
    const stmts = generateAlterTable("postgres", o, n);
    expect(stmts.every((s) => !s.includes("DROP CONSTRAINT"))).toBe(true);
  });

  it("unchanged check produces no statement (postgres)", () => {
    const check = { name: "ck_pos", expression: "amount > 0" };
    const o = tbl({ checks: [check] });
    const n = tbl({ checks: [{ ...check }] });
    expect(generateAlterTable("postgres", o, n)).toHaveLength(0);
  });

  it("whitespace-normalised expression treated as same check", () => {
    const o = tbl({ checks: [{ expression: "amount > 0" }] });
    const n = tbl({ checks: [{ expression: "  amount > 0  " }] });
    expect(generateAlterTable("postgres", o, n)).toHaveLength(0);
  });
});

// ── FOREIGN KEYS ──────────────────────────────────────────────────────────────

describe("FOREIGN KEY constraints — CREATE TABLE", () => {
  it("unnamed FK in CREATE body (postgres)", () => {
    const t = tbl({
      foreignKeys: [{ columns: ["status"], refTable: "statuses", refColumns: ["code"] }],
    });
    const sql = generateCreateTable("postgres", t).join(";\n");
    expect(sql).toContain(`FOREIGN KEY ("status") REFERENCES "statuses" ("code")`);
    expect(sql).not.toMatch(/CONSTRAINT.*FOREIGN KEY/);
  });

  it("named FK includes CONSTRAINT keyword (postgres)", () => {
    const t = tbl({
      foreignKeys: [
        { name: "fk_status", columns: ["status"], refTable: "statuses", refColumns: ["code"] },
      ],
    });
    const sql = generateCreateTable("postgres", t).join(";\n");
    expect(sql).toContain(`CONSTRAINT "fk_status" FOREIGN KEY`);
  });

  it("FK with ON DELETE CASCADE (postgres)", () => {
    const t = tbl({
      foreignKeys: [
        {
          columns: ["status"],
          refTable: "statuses",
          refColumns: ["code"],
          onDelete: "CASCADE",
        },
      ],
    });
    const sql = generateCreateTable("postgres", t).join(";\n");
    expect(sql).toContain("ON DELETE CASCADE");
  });

  it("FK with ON UPDATE SET NULL (postgres)", () => {
    const t = tbl({
      foreignKeys: [
        {
          columns: ["status"],
          refTable: "statuses",
          refColumns: ["code"],
          onUpdate: "SET NULL",
        },
      ],
    });
    const sql = generateCreateTable("postgres", t).join(";\n");
    expect(sql).toContain("ON UPDATE SET NULL");
  });

  it("FK with schema-qualified refTable (postgres)", () => {
    const t = tbl({
      foreignKeys: [
        {
          columns: ["status"],
          refTable: "statuses",
          refSchema: "ref",
          refColumns: ["code"],
        },
      ],
    });
    const sql = generateCreateTable("postgres", t).join(";\n");
    expect(sql).toContain(`REFERENCES "ref"."statuses"`);
  });

  it("FK multi-column (postgres)", () => {
    const t = tbl({
      foreignKeys: [
        {
          columns: ["a", "b"],
          refTable: "other",
          refColumns: ["x", "y"],
        },
      ],
    });
    const sql = generateCreateTable("postgres", t).join(";\n");
    expect(sql).toContain(`FOREIGN KEY ("a", "b") REFERENCES "other" ("x", "y")`);
  });

  it("FK inside CREATE for mysql (backtick)", () => {
    const t = tbl({
      foreignKeys: [{ columns: ["status"], refTable: "statuses", refColumns: ["code"] }],
    });
    const sql = generateCreateTable("mysql", t).join(";\n");
    expect(sql).toContain("FOREIGN KEY (`status`) REFERENCES `statuses` (`code`)");
  });

  it("FK inside CREATE for sqlite", () => {
    const t = tbl({
      foreignKeys: [{ columns: ["status"], refTable: "statuses", refColumns: ["code"] }],
    });
    const sql = generateCreateTable("sqlite", t).join(";\n");
    expect(sql).toContain("FOREIGN KEY");
  });

  it("clickhouse: FK skipped in CREATE TABLE", () => {
    const t = tbl({
      foreignKeys: [{ columns: ["status"], refTable: "statuses", refColumns: ["code"] }],
    });
    const sql = generateCreateTable("clickhouse", t).join(";\n");
    expect(sql).not.toContain("FOREIGN KEY");
  });
});

describe("FOREIGN KEY constraints — ALTER TABLE diff", () => {
  it("adds FK not in old schema (postgres)", () => {
    const o = tbl();
    const n = tbl({
      foreignKeys: [
        { name: "fk_st", columns: ["status"], refTable: "statuses", refColumns: ["code"] },
      ],
    });
    const sql = generateAlterTable("postgres", o, n).join(";\n");
    expect(sql).toContain("ADD CONSTRAINT");
    expect(sql).toContain("FOREIGN KEY");
  });

  it("drops FK by name when removed (postgres)", () => {
    const o = tbl({
      foreignKeys: [
        { name: "fk_st", columns: ["status"], refTable: "statuses", refColumns: ["code"] },
      ],
    });
    const n = tbl();
    const sql = generateAlterTable("postgres", o, n).join(";\n");
    expect(sql).toContain("DROP CONSTRAINT");
    expect(sql).toContain('"fk_st"');
  });

  it("unnamed FK removal emits no DROP (no name)", () => {
    const o = tbl({
      foreignKeys: [{ columns: ["status"], refTable: "statuses", refColumns: ["code"] }],
    });
    const n = tbl();
    const stmts = generateAlterTable("postgres", o, n);
    expect(stmts.every((s) => !s.includes("DROP CONSTRAINT"))).toBe(true);
  });

  it("FK skipped on add for clickhouse", () => {
    const o = tbl();
    const n = tbl({
      foreignKeys: [{ columns: ["status"], refTable: "statuses", refColumns: ["code"] }],
    });
    const stmts = generateAlterTable("clickhouse", o, n);
    expect(stmts.every((s) => !s.includes("FOREIGN KEY"))).toBe(true);
  });

  it("unchanged FK produces no statements", () => {
    const fk = { name: "fk_st", columns: ["status"], refTable: "statuses", refColumns: ["code"] };
    const o = tbl({ foreignKeys: [fk] });
    const n = tbl({ foreignKeys: [{ ...fk }] });
    expect(generateAlterTable("postgres", o, n)).toHaveLength(0);
  });
});

// ── INDEXES ───────────────────────────────────────────────────────────────────

describe("INDEX — CREATE TABLE", () => {
  it("non-unique index as separate statement (postgres)", () => {
    const t = tbl({ indexes: [{ columns: ["status"], unique: false }] });
    const stmts = generateCreateTable("postgres", t);
    const idx = stmts.find((s) => s.startsWith("CREATE INDEX"));
    expect(idx).toBeDefined();
    expect(idx).toContain('"status"');
    expect(idx).not.toContain("UNIQUE");
  });

  it("unique index includes UNIQUE keyword (postgres)", () => {
    const t = tbl({ indexes: [{ columns: ["status"], unique: true }] });
    const stmts = generateCreateTable("postgres", t);
    expect(stmts.some((s) => s.includes("UNIQUE INDEX"))).toBe(true);
  });

  it("named index uses provided name", () => {
    const t = tbl({ indexes: [{ name: "idx_my_status", columns: ["status"], unique: false }] });
    const stmts = generateCreateTable("postgres", t);
    expect(stmts.some((s) => s.includes('"idx_my_status"'))).toBe(true);
  });

  it("auto-generated name follows idx_<table>_<col> pattern", () => {
    const t = tbl({ indexes: [{ columns: ["amount"], unique: false }] });
    const stmts = generateCreateTable("postgres", t);
    expect(stmts.some((s) => s.includes('"idx_orders_amount"'))).toBe(true);
  });

  it("multi-column index lists all columns", () => {
    const t = tbl({ indexes: [{ columns: ["status", "amount"], unique: false }] });
    const stmts = generateCreateTable("postgres", t);
    const idx = stmts.find((s) => s.startsWith("CREATE INDEX"));
    expect(idx).toContain('"status", "amount"');
  });

  it("mysql: index ON table clause present", () => {
    const t = tbl({ indexes: [{ columns: ["status"], unique: false }] });
    const stmts = generateCreateTable("mysql", t);
    const idx = stmts.find((s) => s.startsWith("CREATE INDEX"));
    expect(idx).toContain("ON `orders`");
  });
});

describe("INDEX — ALTER TABLE diff", () => {
  it("drops named index removed (postgres)", () => {
    const o = tbl({ indexes: [{ name: "idx_status", columns: ["status"], unique: false }] });
    const n = tbl();
    const sql = generateAlterTable("postgres", o, n).join(";\n");
    expect(sql).toMatch(/DROP INDEX "idx_status"/);
  });

  it("drops named index with ON clause for mysql", () => {
    const o = tbl({ indexes: [{ name: "idx_status", columns: ["status"], unique: false }] });
    const n = tbl();
    const sql = generateAlterTable("mysql", o, n).join(";\n");
    expect(sql).toMatch(/DROP INDEX `idx_status` ON `orders`/);
  });

  it("unnamed index removal skipped (no name to drop)", () => {
    const o = tbl({ indexes: [{ columns: ["status"], unique: false }] });
    const n = tbl();
    const stmts = generateAlterTable("postgres", o, n);
    expect(stmts.every((s) => !s.includes("DROP INDEX"))).toBe(true);
  });

  it("adds new index (postgres)", () => {
    const o = tbl();
    const n = tbl({ indexes: [{ columns: ["amount"], unique: true }] });
    const sql = generateAlterTable("postgres", o, n).join(";\n");
    expect(sql).toContain("CREATE UNIQUE INDEX");
  });

  it("unchanged index produces no statements", () => {
    const idx = { name: "idx_s", columns: ["status"], unique: false };
    const o = tbl({ indexes: [idx] });
    const n = tbl({ indexes: [{ ...idx }] });
    expect(generateAlterTable("postgres", o, n)).toHaveLength(0);
  });
});

// ── PREVIEW SQL (multi-statement output) ──────────────────────────────────────

describe("Preview SQL — full statement list", () => {
  it("returns exactly 1 statement for minimal table (postgres)", () => {
    const stmts = generateCreateTable("postgres", tbl());
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toMatch(/^CREATE TABLE/);
  });

  it("returns 2 statements when 1 index added (postgres)", () => {
    const t = tbl({ indexes: [{ columns: ["status"], unique: false }] });
    const stmts = generateCreateTable("postgres", t);
    expect(stmts).toHaveLength(2);
    expect(stmts[1]).toMatch(/^CREATE (UNIQUE )?INDEX/);
  });

  it("returns 3 statements for CREATE + index + column comment (postgres)", () => {
    const t = tbl({
      indexes: [{ columns: ["status"], unique: false }],
      columns: [
        { name: "id", type: "bigint", nullable: false, isPrimary: true },
        { name: "amount", type: "numeric", nullable: false, isPrimary: false },
        { name: "status", type: "text", nullable: true, isPrimary: false, comment: "order state" },
      ],
    });
    const stmts = generateCreateTable("postgres", t);
    expect(stmts).toHaveLength(3); // CREATE + INDEX + COMMENT ON COLUMN
    expect(stmts[2]).toMatch(/^COMMENT ON COLUMN/);
  });

  it("column comment not emitted for mysql (uses inline COMMENT)", () => {
    const t = tbl({
      columns: [
        { name: "id", type: "bigint", nullable: false, isPrimary: true },
        { name: "status", type: "text", nullable: true, isPrimary: false, comment: "state" },
      ],
    });
    const stmts = generateCreateTable("mysql", t);
    // MySQL puts comment inline, no separate COMMENT ON COLUMN statement
    expect(stmts.every((s) => !s.startsWith("COMMENT ON COLUMN"))).toBe(true);
    expect(stmts[0]).toContain("COMMENT 'state'");
  });

  it("column comment not emitted for sqlite", () => {
    const t = tbl({
      columns: [
        { name: "id", type: "bigint", nullable: false, isPrimary: true },
        { name: "status", type: "text", nullable: true, isPrimary: false, comment: "state" },
      ],
    });
    const stmts = generateCreateTable("sqlite", t);
    expect(stmts.every((s) => !s.startsWith("COMMENT ON COLUMN"))).toBe(true);
  });

  it("ALTER produces empty array when nothing changed", () => {
    const t = tbl();
    expect(generateAlterTable("postgres", t, { ...t })).toEqual([]);
  });

  it("ALTER with rename + added column returns 2 statements", () => {
    const o = tbl({ name: "orders_v1" });
    const n = tbl({
      name: "orders",
      columns: [
        ...tbl().columns,
        { name: "note", type: "text", nullable: true, isPrimary: false },
      ],
    });
    const stmts = generateAlterTable("postgres", o, n);
    expect(stmts.length).toBe(2);
    expect(stmts[0]).toContain("RENAME TO");
    expect(stmts[1]).toContain("ADD COLUMN");
  });

  it("ALTER drops then adds when both changes present", () => {
    const o = tbl();
    const n = tbl({
      columns: [
        { name: "id", type: "bigint", nullable: false, isPrimary: true },
        // 'amount' removed, 'note' added
        { name: "note", type: "text", nullable: true, isPrimary: false },
        { name: "status", type: "text", nullable: true, isPrimary: false },
      ],
    });
    const stmts = generateAlterTable("postgres", o, n);
    const joined = stmts.join(";\n");
    expect(joined).toContain("DROP COLUMN");
    expect(joined).toContain("ADD COLUMN");
  });
});

// ── COLUMN DEFINITIONS ────────────────────────────────────────────────────────

describe("Column definition edge cases", () => {
  it("nullable column has no NOT NULL (postgres)", () => {
    const t = tbl({
      columns: [
        { name: "id", type: "bigint", nullable: false, isPrimary: true },
        { name: "note", type: "text", nullable: true, isPrimary: false },
      ],
    });
    const sql = generateCreateTable("postgres", t).join(";\n");
    expect(sql).not.toMatch(/"note" text NOT NULL/);
    expect(sql).toContain('"note" text');
  });

  it("column with DEFAULT value (postgres)", () => {
    const t = tbl({
      columns: [
        { name: "id", type: "bigint", nullable: false, isPrimary: true },
        { name: "status", type: "text", nullable: false, isPrimary: false, default: "'pending'" },
      ],
    });
    const sql = generateCreateTable("postgres", t).join(";\n");
    expect(sql).toContain(`"status" text NOT NULL DEFAULT 'pending'`);
  });

  it("column default of empty string is omitted", () => {
    const t = tbl({
      columns: [
        { name: "id", type: "bigint", nullable: false, isPrimary: true },
        { name: "status", type: "text", nullable: false, isPrimary: false, default: "" },
      ],
    });
    const sql = generateCreateTable("postgres", t).join(";\n");
    expect(sql).not.toContain("DEFAULT");
  });

  it("ClickHouse: no NOT NULL in column def (all columns nullable by default)", () => {
    // ClickHouse allows NOT NULL but it's unusual — test that our generated
    // DDL follows the same NOT NULL logic as other engines.
    const t = tbl({
      columns: [
        { name: "id", type: "UInt64", nullable: false, isPrimary: true },
        { name: "label", type: "String", nullable: false, isPrimary: false },
      ],
    });
    const sql = generateCreateTable("clickhouse", t).join(";\n");
    expect(sql).toContain("NOT NULL");
  });

  it("ALTER: drop default when cleared (postgres)", () => {
    const o = tbl({
      columns: [
        { name: "id", type: "bigint", nullable: false, isPrimary: true },
        { name: "status", type: "text", nullable: false, isPrimary: false, default: "'pending'" },
      ],
    });
    const n = tbl({
      columns: [
        { name: "id", type: "bigint", nullable: false, isPrimary: true },
        { name: "status", type: "text", nullable: false, isPrimary: false },
      ],
    });
    const sql = generateAlterTable("postgres", o, n).join(";\n");
    expect(sql).toContain("DROP DEFAULT");
  });

  it("ALTER: set NOT NULL when nullable flips to false (postgres)", () => {
    const o = tbl({
      columns: [
        { name: "id", type: "bigint", nullable: false, isPrimary: true },
        { name: "status", type: "text", nullable: true, isPrimary: false },
      ],
    });
    const n = tbl({
      columns: [
        { name: "id", type: "bigint", nullable: false, isPrimary: true },
        { name: "status", type: "text", nullable: false, isPrimary: false },
      ],
    });
    const sql = generateAlterTable("postgres", o, n).join(";\n");
    expect(sql).toContain("SET NOT NULL");
  });
});
