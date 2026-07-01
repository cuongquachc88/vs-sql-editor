// Additional tests for edit/sql.ts — edge cases not covered in sql.test.ts.
import { describe, it, expect } from "vitest";
import { formatLiteral, buildUpdate, quoteDoubleQuote, quoteBacktick } from "./sql";
import { PgliteDriver } from "../drivers/pglite";

describe("formatLiteral — edge cases", () => {
  it("handles Infinity as a string (not a finite number)", () => {
    expect(formatLiteral(Infinity)).toBe("'Infinity'");
    expect(formatLiteral(-Infinity)).toBe("'-Infinity'");
  });

  it("handles NaN as a string", () => {
    expect(formatLiteral(NaN)).toBe("'NaN'");
  });

  it("escapes multiple single quotes in a string", () => {
    expect(formatLiteral("it's a 'test'")).toBe("'it''s a ''test'''");
  });

  it("handles empty string", () => {
    expect(formatLiteral("")).toBe("''");
  });

  it("handles numeric strings (kept as strings)", () => {
    expect(formatLiteral("42")).toBe("'42'");
  });

  it("handles false (boolean)", () => {
    expect(formatLiteral(false)).toBe("FALSE");
  });

  it("handles floating point numbers", () => {
    expect(formatLiteral(3.14)).toBe("3.14");
    expect(formatLiteral(-0.5)).toBe("-0.5");
  });
});

describe("buildUpdate — identifier quoting edge cases", () => {
  it("quoteDoubleQuote escapes embedded double quotes in column names", () => {
    // Unusual but valid SQL identifier: column named say"hi"
    const sql = buildUpdate(quoteDoubleQuote, '"t"', { 'a"b': 1 }, { 'x"y': "val" });
    expect(sql).toContain('"a""b"');
    expect(sql).toContain('"x""y"');
  });

  it("quoteBacktick escapes embedded backticks in column names", () => {
    const sql = buildUpdate(quoteBacktick, "`t`", { "a`b": 1 }, { "x`y": "val" });
    expect(sql).toContain("`a``b`");
    expect(sql).toContain("`x``y`");
  });

  it("handles null value in changes (sets column to NULL)", () => {
    const sql = buildUpdate(quoteDoubleQuote, '"t"', { id: 1 }, { label: null });
    expect(sql).toContain('"label" = NULL');
  });

  it("handles boolean values in changes", () => {
    const sql = buildUpdate(quoteDoubleQuote, '"t"', { id: 1 }, { active: true });
    expect(sql).toContain('"active" = TRUE');
    const sql2 = buildUpdate(quoteDoubleQuote, '"t"', { id: 1 }, { active: false });
    expect(sql2).toContain('"active" = FALSE');
  });
});

describe("buildUpdate — E2E applied against PGlite", () => {

  it("UPDATE with boolean change round-trips correctly", async () => {
    const driver = new PgliteDriver();
    const session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    try {
      await driver.query(session, "create table flags (id int primary key, enabled boolean)");
      await driver.query(session, "insert into flags values (1, false)");

      const sql = buildUpdate(quoteDoubleQuote, '"public"."flags"', { id: 1 }, { enabled: true });
      await driver.query(session, sql);

      const rs = await driver.query(session, "select enabled from flags where id = 1");
      expect(rs.rows[0][0]).toBe(true);
    } finally {
      await driver.dispose(session);
    }
  });

  it("UPDATE with NULL change sets the column to NULL", async () => {
    const driver = new PgliteDriver();
    const session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    try {
      await driver.query(session, "create table notes (id int primary key, body text)");
      await driver.query(session, "insert into notes values (1, 'original')");

      const sql = buildUpdate(quoteDoubleQuote, '"public"."notes"', { id: 1 }, { body: null });
      await driver.query(session, sql);

      const rs = await driver.query(session, "select body from notes where id = 1");
      expect(rs.rows[0][0]).toBeNull();
    } finally {
      await driver.dispose(session);
    }
  });
});
