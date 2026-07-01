// Additional tests for buildInsertSql covering boolean literals, ClickHouse,
// and edge cases around literal formatting.
import { describe, it, expect } from "vitest";
import { buildInsertSql } from "./runner";

describe("buildInsertSql — boolean literals", () => {
  it("postgres: true/false → TRUE/FALSE", () => {
    const sql = buildInsertSql(
      "postgres",
      '"t"',
      [{ name: "active", type: "boolean" }],
      [["true"], ["false"], ["t"], ["f"]],
    );
    expect(sql).toContain("(TRUE)");
    expect(sql).toContain("(FALSE)");
  });

  it("mysql: true/false → 1/0", () => {
    const sql = buildInsertSql(
      "mysql",
      "`t`",
      [{ name: "active", type: "boolean" }],
      [["true"], ["false"], ["1"], ["0"]],
    );
    expect(sql).toContain("(1)");
    expect(sql).toContain("(0)");
    expect(sql).not.toContain("TRUE");
  });

  it("sqlite: boolean stored as INTEGER — true→TRUE, false→FALSE (same as postgres)", () => {
    const sql = buildInsertSql(
      "sqlite",
      '"t"',
      [{ name: "active", type: "boolean" }],
      [["true"], ["false"]],
    );
    expect(sql).toContain("(TRUE)");
    expect(sql).toContain("(FALSE)");
  });

  it("non-boolean string in boolean column falls back to quoted string", () => {
    const sql = buildInsertSql(
      "postgres",
      '"t"',
      [{ name: "flag", type: "boolean" }],
      [["maybe"]],
    );
    expect(sql).toContain("('maybe')");
  });
});

describe("buildInsertSql — real literals", () => {
  it("valid decimal/scientific numbers emitted unquoted", () => {
    const sql = buildInsertSql(
      "postgres",
      '"t"',
      [{ name: "v", type: "real" }],
      [["3.14"], ["-1.5"], ["1e10"]],
    );
    expect(sql).toContain("(3.14)");
    expect(sql).toContain("(-1.5)");
    expect(sql).toContain("(1e10)");
  });

  it("non-numeric value in real column is quoted as string", () => {
    const sql = buildInsertSql(
      "postgres",
      '"t"',
      [{ name: "v", type: "real" }],
      [["NaN"]],
    );
    expect(sql).toContain("('NaN')");
  });
});

describe("buildInsertSql — ClickHouse identifiers", () => {
  it("double-quotes ClickHouse identifiers", () => {
    const sql = buildInsertSql(
      "clickhouse",
      '"default"."events"',
      [{ name: "event_type", type: "text" }],
      [["click"]],
    );
    expect(sql).toContain('"event_type"');
    expect(sql).toContain("('click')");
  });
});

describe("buildInsertSql — batching and multi-row", () => {
  it("emits one INSERT with all rows in VALUES", () => {
    const sql = buildInsertSql(
      "postgres",
      '"t"',
      [{ name: "n", type: "integer" }],
      [["1"], ["2"], ["3"]],
    );
    const lines = sql.split("\n").filter((l) => l.trim().startsWith("("));
    expect(lines).toHaveLength(3);
  });

  it("handles single quotes inside text values", () => {
    const sql = buildInsertSql(
      "postgres",
      '"t"',
      [{ name: "name", type: "text" }],
      [["O'Brien"], ["it's"]],
    );
    expect(sql).toContain("'O''Brien'");
    expect(sql).toContain("'it''s'");
  });
});
