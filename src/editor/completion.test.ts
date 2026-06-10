import { describe, it, expect } from "vitest";
import { buildIndex, parseTableAliases, computeCompletions } from "./completion";
import type { SchemaModel } from "../drivers/types";

const MODEL: SchemaModel = {
  databases: [
    {
      name: "app",
      schemas: [
        {
          name: "public",
          tables: [
            {
              name: "users",
              isView: false,
              primaryKey: ["id"],
              columns: [
                { name: "id", type: "int4" },
                { name: "email", type: "text" },
              ],
            },
            {
              name: "orders",
              isView: false,
              primaryKey: ["id"],
              columns: [
                { name: "id", type: "int4" },
                { name: "user_id", type: "int4" },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const index = buildIndex(MODEL);

describe("buildIndex", () => {
  it("indexes tables and their columns", () => {
    expect(index.tables.map((t) => t.name).sort()).toEqual(["orders", "users"]);
    expect(index.columnsByTable.get("users")!.map((c) => c.name)).toEqual(["id", "email"]);
  });
});

describe("parseTableAliases", () => {
  it("maps tables and aliases from FROM/JOIN", () => {
    const map = parseTableAliases("select * from users u join orders as o on o.user_id = u.id");
    expect(map.get("u")).toBe("users");
    expect(map.get("o")).toBe("orders");
    expect(map.get("users")).toBe("users");
    expect(map.get("orders")).toBe("orders");
  });

  it("does not treat keywords as aliases", () => {
    const map = parseTableAliases("select * from users where id = 1");
    expect(map.get("where")).toBeUndefined();
    expect(map.get("users")).toBe("users");
  });
});

describe("computeCompletions", () => {
  it("suggests columns for an alias before a dot", () => {
    const alias = parseTableAliases("select  from users u");
    const out = computeCompletions(index, alias, "select u.");
    expect(out.every((s) => s.kind === "column")).toBe(true);
    expect(out.map((s) => s.label)).toEqual(["id", "email"]);
  });

  it("suggests columns for a bare table name before a dot", () => {
    const out = computeCompletions(index, new Map(), "select orders.");
    expect(out.map((s) => s.label)).toEqual(["id", "user_id"]);
  });

  it("suggests tables and keywords with no dot context", () => {
    const out = computeCompletions(index, new Map(), "select * from ");
    expect(out.some((s) => s.kind === "table" && s.label === "users")).toBe(true);
    expect(out.some((s) => s.kind === "keyword" && s.label === "where")).toBe(true);
  });

  it("returns nothing for an unknown alias before a dot", () => {
    const out = computeCompletions(index, new Map(), "select x.");
    expect(out).toEqual([]);
  });
});
