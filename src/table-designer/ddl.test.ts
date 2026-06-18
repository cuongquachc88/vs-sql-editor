import { describe, it, expect } from "vitest";
import { generateCreateTable, generateAlterTable } from "./ddl";
import type { TableSchema } from "./model";

const baseTable = (overrides: Partial<TableSchema> = {}): TableSchema => ({
  schema: "public",
  name: "person",
  columns: [
    { name: "id", type: "bigint", nullable: false, isPrimary: true },
    { name: "name", type: "text", nullable: false, isPrimary: false },
  ],
  foreignKeys: [],
  indexes: [],
  checks: [],
  ...overrides,
});

describe("generateCreateTable", () => {
  it("Postgres: single PK inline", () => {
    const sql = generateCreateTable("postgres", baseTable()).join(";\n");
    expect(sql).toContain(`CREATE TABLE "public"."person"`);
    expect(sql).toContain(`"id" bigint NOT NULL PRIMARY KEY`);
    expect(sql).toContain(`"name" text NOT NULL`);
  });

  it("MySQL: backticks + inline PK", () => {
    const sql = generateCreateTable("mysql", baseTable()).join(";\n");
    expect(sql).toContain("CREATE TABLE `person`");
    expect(sql).toContain("`id` bigint NOT NULL PRIMARY KEY");
  });

  it("SQLite: table-level (no schema qualifier)", () => {
    const sql = generateCreateTable("sqlite", baseTable()).join(";\n");
    expect(sql).toContain(`CREATE TABLE "person"`);
    expect(sql).not.toContain(`"public"."person"`);
  });

  it("ClickHouse: ENGINE + ORDER BY clause", () => {
    const sql = generateCreateTable("clickhouse", baseTable()).join(";\n");
    expect(sql).toContain("CREATE TABLE");
    expect(sql).toContain("ENGINE = MergeTree()");
    expect(sql).toContain(`ORDER BY ("id")`);
  });

  it("Postgres: composite PK at table level", () => {
    const t = baseTable({
      columns: [
        { name: "a", type: "int", nullable: false, isPrimary: true },
        { name: "b", type: "int", nullable: false, isPrimary: true },
      ],
    });
    const sql = generateCreateTable("postgres", t).join(";\n");
    expect(sql).toContain(`PRIMARY KEY ("a", "b")`);
    expect(sql).not.toContain(`PRIMARY KEY` + `\n`); // no inline
  });

  it("Postgres: FK + index + check + comment", () => {
    const t = baseTable({
      foreignKeys: [
        {
          columns: ["country_code"],
          refTable: "country",
          refColumns: ["code"],
          onDelete: "CASCADE",
        },
      ],
      indexes: [{ columns: ["name"], unique: false }],
      checks: [{ expression: "id > 0" }],
      columns: [
        ...baseTable().columns,
        {
          name: "country_code",
          type: "text",
          nullable: true,
          isPrimary: false,
          comment: "ISO code",
        },
      ],
    });
    const sql = generateCreateTable("postgres", t).join(";\n");
    expect(sql).toContain(`FOREIGN KEY ("country_code") REFERENCES "country"`);
    expect(sql).toContain("ON DELETE CASCADE");
    expect(sql).toContain("CHECK (id > 0)");
    expect(sql).toContain(`CREATE INDEX "idx_person_name"`);
    expect(sql).toContain(`COMMENT ON COLUMN`);
  });
});

describe("generateAlterTable", () => {
  it("Postgres: detects added column", () => {
    const oldT = baseTable();
    const newT = baseTable({
      columns: [
        ...baseTable().columns,
        { name: "email", type: "text", nullable: true, isPrimary: false },
      ],
    });
    const sql = generateAlterTable("postgres", oldT, newT).join(";\n");
    expect(sql).toContain(`ADD COLUMN "email" text`);
  });
  it("Postgres: detects dropped column", () => {
    const oldT = baseTable();
    const newT = baseTable({
      columns: [{ name: "id", type: "bigint", nullable: false, isPrimary: true }],
    });
    const sql = generateAlterTable("postgres", oldT, newT).join(";\n");
    expect(sql).toContain(`DROP COLUMN "name"`);
  });
  it("Postgres: detects type change", () => {
    const oldT = baseTable();
    const newT = baseTable({
      columns: [
        { name: "id", type: "bigint", nullable: false, isPrimary: true },
        { name: "name", type: "varchar(255)", nullable: false, isPrimary: false },
      ],
    });
    const sql = generateAlterTable("postgres", oldT, newT).join(";\n");
    expect(sql).toContain(`ALTER COLUMN "name" TYPE varchar(255)`);
  });
  it("Postgres: detects nullability + default toggle", () => {
    const oldT = baseTable();
    const newT = baseTable({
      columns: [
        { name: "id", type: "bigint", nullable: false, isPrimary: true },
        { name: "name", type: "text", nullable: true, isPrimary: false, default: "'?'" },
      ],
    });
    const sql = generateAlterTable("postgres", oldT, newT).join(";\n");
    expect(sql).toContain("DROP NOT NULL");
    expect(sql).toContain("SET DEFAULT '?'");
  });
  it("rename TO statement", () => {
    const oldT = baseTable({ name: "person_old" });
    const newT = baseTable({ name: "person" });
    const sql = generateAlterTable("postgres", oldT, newT).join(";\n");
    expect(sql).toContain(`RENAME TO "person"`);
  });
});
