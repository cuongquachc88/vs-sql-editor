import { describe, it, expect } from "vitest";
import type { SchemaModel } from "../drivers/types";
import {
  buildSchemaDigest,
  pickRelevantDigest,
  buildNlToSqlPrompt,
  buildExplainPrompt,
  buildFixPrompt,
  buildCompletionPrompt,
} from "./prompts";

const MODEL: SchemaModel = {
  databases: [
    {
      name: "app",
      schemas: [
        {
          name: "public",
          functions: [],
          tables: [
            {
              name: "users",
              isView: false,
              primaryKey: ["id"],
              foreignKeys: [],
              columns: [
                { name: "id", type: "int" },
                { name: "email", type: "text" },
              ],
            },
            {
              name: "orders",
              isView: false,
              primaryKey: ["id"],
              foreignKeys: [
                { columns: ["user_id"], refTable: "users", refColumns: ["id"] },
              ],
              columns: [
                { name: "id", type: "int" },
                { name: "user_id", type: "int" },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("buildSchemaDigest", () => {
  it("renders a compact digest with PK and FK markers", () => {
    const out = buildSchemaDigest(MODEL);
    expect(out).toContain("public.users(id int pk, email text)");
    expect(out).toContain("public.orders(id int pk, user_id int) FK user_id->users(id)");
  });
  it("handles undefined model", () => {
    expect(buildSchemaDigest(undefined)).toMatch(/no schema/i);
  });
});

describe("pickRelevantDigest", () => {
  it("returns the full digest when it fits in budget", () => {
    expect(pickRelevantDigest(MODEL, "anything")).toBe(buildSchemaDigest(MODEL));
  });
});

describe("prompt builders include engine-specific reminders", () => {
  it("NL→SQL prompt mentions Postgres for postgres", () => {
    const p = buildNlToSqlPrompt({
      engine: "postgres",
      schemaDigest: "x",
      question: "list users",
    });
    expect(p.system).toMatch(/PostgreSQL/);
    expect(p.user).toBe("list users");
  });
  it("Explain prompt mentions MySQL for mysql", () => {
    const p = buildExplainPrompt({
      engine: "mysql",
      schemaDigest: "x",
      sql: "select 1",
    });
    expect(p.system).toMatch(/MySQL/);
    expect(p.user).toContain("Explain this query");
    expect(p.user).toContain("select 1");
  });
  it("Fix prompt includes the error message verbatim", () => {
    const p = buildFixPrompt({
      engine: "sqlite",
      schemaDigest: "x",
      sql: "select * from no_table",
      errorMessage: "no such table: no_table",
    });
    expect(p.user).toContain("no such table: no_table");
  });
  it("Completion prompt asks for next lines without fences", () => {
    const p = buildCompletionPrompt({
      engine: "clickhouse",
      schemaDigest: "x",
      contextBefore: "select ",
    });
    expect(p.system).toMatch(/Return only the next/);
    expect(p.user).toContain("select ");
  });
});
