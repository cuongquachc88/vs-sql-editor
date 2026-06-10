import { describe, it, expect } from "vitest";
import { SchemaExplorerProvider, qualifyTable, type TreeNode } from "./tree";
import type { SchemaModel } from "../drivers/types";

const MODEL: SchemaModel = {
  databases: [
    {
      name: "appdb",
      schemas: [
        {
          name: "public",
          tables: [
            {
              name: "person",
              isView: false,
              columns: [
                { name: "id", type: "int4" },
                { name: "name", type: "text" },
              ],
              primaryKey: ["id"],
            },
          ],
        },
      ],
    },
  ],
};

function makeProvider() {
  return new SchemaExplorerProvider(
    () => [{ id: "p1", name: "Local", engine: "postgres" }],
    async () => MODEL,
  );
}

describe("SchemaExplorerProvider", () => {
  it("lists connections at the root", async () => {
    const children = await makeProvider().getChildren();
    expect(children).toEqual([{ kind: "connection", profileId: "p1", label: "Local", engine: "postgres" }]);
  });

  it("walks connection -> database -> schema -> table -> columns", async () => {
    const p = makeProvider();
    const [conn] = await p.getChildren();
    const dbs = await p.getChildren(conn);
    expect(dbs[0]).toMatchObject({ kind: "database", database: "appdb" });
    const schemas = await p.getChildren(dbs[0]);
    expect(schemas[0]).toMatchObject({ kind: "schema", schema: "public" });
    const tables = await p.getChildren(schemas[0]);
    expect(tables[0]).toMatchObject({ kind: "table", table: "person", isView: false });
    const cols = await p.getChildren(tables[0]);
    expect(cols.map((c) => (c as Extract<TreeNode, { kind: "column" }>).label)).toEqual(["id", "name"]);
  });
});

describe("qualifyTable", () => {
  it("quotes per engine", () => {
    expect(qualifyTable("postgres", "public", "t")).toBe('"public"."t"');
    expect(qualifyTable("mysql", "appdb", "t")).toBe("`appdb`.`t`");
    expect(qualifyTable("sqlite", "main", "t")).toBe('"t"');
    expect(qualifyTable("clickhouse", "default", "t")).toBe('"default"."t"');
  });
});
