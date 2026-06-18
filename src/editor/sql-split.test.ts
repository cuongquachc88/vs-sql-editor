import { describe, it, expect } from "vitest";
import { splitSqlStatements } from "./sql-split";

describe("splitSqlStatements", () => {
  it("single statement without terminator", () => {
    expect(splitSqlStatements("select 1")).toEqual(["select 1"]);
  });

  it("single statement with terminator", () => {
    expect(splitSqlStatements("select 1;")).toEqual(["select 1"]);
  });

  it("two statements separated by ;", () => {
    expect(splitSqlStatements("select 1; select 2")).toEqual(["select 1", "select 2"]);
  });

  it("trailing whitespace + empty trailing statement is dropped", () => {
    expect(splitSqlStatements("select 1;\n\n")).toEqual(["select 1"]);
  });

  it("ignores ; inside single-quoted strings", () => {
    expect(splitSqlStatements("select 'a;b'; select 2")).toEqual([
      "select 'a;b'",
      "select 2",
    ]);
  });

  it("handles escaped single quote", () => {
    expect(splitSqlStatements("select 'O''Brien'; select 2")).toEqual([
      "select 'O''Brien'",
      "select 2",
    ]);
  });

  it("ignores ; inside double-quoted identifiers", () => {
    expect(splitSqlStatements(`select "a;b"; select 2`)).toEqual([
      `select "a;b"`,
      "select 2",
    ]);
  });

  it("ignores ; inside line comments", () => {
    expect(
      splitSqlStatements("-- top;\nselect 1; -- after\nselect 2"),
    ).toEqual([
      "-- top;\nselect 1",
      "-- after\nselect 2",
    ]);
  });

  it("ignores ; inside block comments", () => {
    expect(
      splitSqlStatements("/* a; b */ select 1; /* c\n;d */ select 2"),
    ).toEqual(["/* a; b */ select 1", "/* c\n;d */ select 2"]);
  });

  it("multi-line DDL with embedded ;", () => {
    const sql = `
      create table x (
        id int,
        name text
      );
      insert into x values (1, 'a;b');
      select * from x;
    `;
    const out = splitSqlStatements(sql);
    expect(out).toHaveLength(3);
    expect(out[0]).toContain("create table x");
    expect(out[1]).toContain("insert into x");
    expect(out[2]).toContain("select * from x");
  });

  it("empty input returns []", () => {
    expect(splitSqlStatements("")).toEqual([]);
    expect(splitSqlStatements("   \n\n   ")).toEqual([]);
    expect(splitSqlStatements(";;;")).toEqual([]);
  });
});
