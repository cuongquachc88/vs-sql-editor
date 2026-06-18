import { describe, it, expect } from "vitest";
import { quoteIdent, sqlTypeFor } from "./sql-types";

describe("sqlTypeFor", () => {
  it("maps inferred types per engine", () => {
    expect(sqlTypeFor("postgres", "integer")).toBe("bigint");
    expect(sqlTypeFor("postgres", "real")).toBe("double precision");
    expect(sqlTypeFor("postgres", "boolean")).toBe("boolean");
    expect(sqlTypeFor("postgres", "text")).toBe("text");

    expect(sqlTypeFor("mysql", "integer")).toBe("bigint");
    expect(sqlTypeFor("mysql", "boolean")).toBe("tinyint(1)");

    expect(sqlTypeFor("sqlite", "integer")).toBe("INTEGER");
    expect(sqlTypeFor("sqlite", "real")).toBe("REAL");

    expect(sqlTypeFor("clickhouse", "integer")).toBe("Int64");
    expect(sqlTypeFor("clickhouse", "boolean")).toBe("Bool");

    expect(sqlTypeFor("pglite", "real")).toBe("double precision");
  });
});

describe("quoteIdent", () => {
  it("double-quotes most engines and escapes embedded quotes", () => {
    expect(quoteIdent("postgres", "my table")).toBe('"my table"');
    expect(quoteIdent("postgres", 'a"b')).toBe('"a""b"');
    expect(quoteIdent("pglite", "x")).toBe('"x"');
    expect(quoteIdent("sqlite", "x")).toBe('"x"');
    expect(quoteIdent("clickhouse", "x")).toBe('"x"');
  });
  it("backticks MySQL identifiers and escapes embedded backticks", () => {
    expect(quoteIdent("mysql", "tbl")).toBe("`tbl`");
    expect(quoteIdent("mysql", "a`b")).toBe("`a``b`");
  });
});
