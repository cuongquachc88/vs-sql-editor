import { describe, it, expect } from "vitest";
import { PgliteDriver } from "../drivers/pglite";
import { SqliteDriver } from "../drivers/sqlite";
import type { ConnectionManager } from "../connections/manager";
import type { DatabaseDriver, Session } from "../drivers/types";
import { importCsvIntoTable, buildInsertSql } from "./runner";

function makeManager(driver: DatabaseDriver, session: Session): ConnectionManager {
  return {
    get: async () => session,
    driverOf: () => driver,
  } as unknown as ConnectionManager;
}

describe("buildInsertSql", () => {
  it("quotes identifiers per engine and escapes strings", () => {
    const sql = buildInsertSql(
      "postgres",
      '"public"."t"',
      [
        { name: "id", type: "integer" },
        { name: "name", type: "text" },
      ],
      [
        ["1", "Ada"],
        ["2", "O'Brien"],
      ],
    );
    expect(sql).toContain('insert into "public"."t" ("id", "name") values');
    expect(sql).toContain("(1, 'Ada')");
    expect(sql).toContain("(2, 'O''Brien')");
  });
  it("uses backticks for MySQL identifiers", () => {
    const sql = buildInsertSql(
      "mysql",
      "`t`",
      [{ name: "n", type: "integer" }],
      [["1"]],
    );
    expect(sql).toContain("insert into `t` (`n`) values");
  });
  it("treats empty string as NULL", () => {
    const sql = buildInsertSql(
      "postgres",
      '"t"',
      [{ name: "n", type: "integer" }],
      [[""]],
    );
    expect(sql).toContain("(NULL)");
  });
});

describe("importCsvIntoTable against PGlite (in-process)", () => {
  it("creates the table and inserts all rows", async () => {
    const driver = new PgliteDriver();
    const session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    try {
      const result = await importCsvIntoTable({
        manager: makeManager(driver, session),
        profileId: "m",
        engine: "pglite",
        targetSchema: "public",
        targetTable: "imported",
        columns: [
          { name: "id", type: "integer" },
          { name: "name", type: "text" },
          { name: "rating", type: "real" },
        ],
        rows: [
          ["1", "Ada", "9.5"],
          ["2", "Grace", "9.8"],
          ["3", "Linus", ""],
        ],
        batchSize: 2,
      });
      expect(result.rowsInserted).toBe(3);
      const rs = await driver.query(session, "select count(*) as n from imported");
      expect(Number((rs.rows[0] as unknown[])[0])).toBe(3);
      const rs2 = await driver.query(
        session,
        "select rating from imported where name = 'Linus'",
      );
      expect(rs2.rows[0][0]).toBeNull();
    } finally {
      await driver.dispose(session);
    }
  });
});

describe("importCsvIntoTable against SQLite (in-process)", () => {
  it("creates the table and inserts all rows", async () => {
    const driver = new SqliteDriver();
    const session = await driver.connect({ id: "m", name: "m", engine: "sqlite" });
    try {
      const result = await importCsvIntoTable({
        manager: makeManager(driver, session),
        profileId: "m",
        engine: "sqlite",
        targetTable: "imported",
        columns: [
          { name: "id", type: "integer" },
          { name: "name", type: "text" },
        ],
        rows: [
          ["1", "Ada"],
          ["2", "Grace"],
        ],
      });
      expect(result.rowsInserted).toBe(2);
      const rs = await driver.query(session, "select name from imported order by id");
      expect(rs.rows.map((r) => r[0])).toEqual(["Ada", "Grace"]);
    } finally {
      await driver.dispose(session);
    }
  });
});
