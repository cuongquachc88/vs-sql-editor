import { describe, it, expect } from "vitest";
import { qualifyTable } from "./qualify";

describe("qualifyTable", () => {
  it("postgres: double-quotes schema and table", () => {
    expect(qualifyTable("postgres", "public", "users")).toBe('"public"."users"');
  });

  it("pglite: same double-quoting as postgres", () => {
    expect(qualifyTable("pglite", "public", "users")).toBe('"public"."users"');
  });

  it("mysql: wraps schema and table in backticks", () => {
    expect(qualifyTable("mysql", "app_db", "users")).toBe("`app_db`.`users`");
  });

  it("clickhouse: double-quotes schema and table", () => {
    expect(qualifyTable("clickhouse", "default", "events")).toBe('"default"."events"');
  });

  it("sqlite: ignores schema, only quotes table", () => {
    expect(qualifyTable("sqlite", "main", "users")).toBe('"users"');
  });

  it("handles table names with spaces", () => {
    expect(qualifyTable("postgres", "my schema", "my table")).toBe('"my schema"."my table"');
  });
});
