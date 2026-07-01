// End-to-end CSV import pipeline:
//   parseCsv → inferTypes → importCsvIntoTable → query real DB
// Both PGlite and SQLite are in-process (WASM) so this runs in CI.
import { describe, it, expect, afterEach } from "vitest";
import { parseCsv } from "../src/import/csv-parser";
import { inferTypes } from "../src/import/infer";
import { importCsvIntoTable } from "../src/import/runner";
import { PgliteDriver } from "../src/drivers/pglite";
import { SqliteDriver } from "../src/drivers/sqlite";
import type { ConnectionManager } from "../src/connections/manager";
import type { DatabaseDriver, Session } from "../src/drivers/types";

function fakeManager(driver: DatabaseDriver, session: Session): ConnectionManager {
  return {
    get: async () => session,
    driverOf: () => driver,
  } as unknown as ConnectionManager;
}

const CSV_BASIC = `id,name,score,active
1,Ada,9.5,true
2,Grace,8.75,false
3,Linus,,true
`;

const CSV_QUOTED = `id,description
1,"hello, world"
2,"she said ""hi"""
3,"line1
line2"
`;

const CSV_BOM = `﻿id,value\n1,alpha\n2,beta\n`;

// ─── PGlite E2E ──────────────────────────────────────────────────────────────

describe("CSV → PGlite E2E", () => {
  const driver = new PgliteDriver();
  let session: Session | undefined;

  afterEach(async () => {
    if (session) {
      await driver.dispose(session);
      session = undefined;
    }
  });

  it("imports basic CSV with mixed types into a new table", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    const rows = parseCsv(CSV_BASIC);
    const [headers, ...dataRows] = rows;
    const types = inferTypes(dataRows);
    const columns = headers.map((name, i) => ({ name, type: types[i] }));

    const result = await importCsvIntoTable({
      manager: fakeManager(driver, session),
      profileId: "m",
      engine: "pglite",
      targetSchema: "public",
      targetTable: "people",
      columns,
      rows: dataRows,
    });

    expect(result.rowsInserted).toBe(3);

    const rs = await driver.query(session, "select id, name, score, active from people order by id");
    expect(rs.rows).toHaveLength(3);

    const [ada, grace, linus] = rs.rows;
    expect(Number(ada[0])).toBe(1);
    expect(ada[1]).toBe("Ada");
    expect(Number(ada[2])).toBeCloseTo(9.5);
    expect(ada[3]).toBe(true);

    expect(grace[3]).toBe(false);
    expect(linus[2]).toBeNull(); // empty → NULL
  });

  it("infers column types correctly for basic CSV", () => {
    const [, ...dataRows] = parseCsv(CSV_BASIC);
    const types = inferTypes(dataRows);
    expect(types[0]).toBe("integer");   // id
    expect(types[1]).toBe("text");      // name
    expect(types[2]).toBe("real");      // score
    expect(types[3]).toBe("boolean");   // active
  });

  it("handles quoted fields with commas, escaped quotes, embedded newlines", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    const rows = parseCsv(CSV_QUOTED);
    const [headers, ...dataRows] = rows;
    const types = inferTypes(dataRows);
    const columns = headers.map((name, i) => ({ name, type: types[i] }));

    await importCsvIntoTable({
      manager: fakeManager(driver, session),
      profileId: "m",
      engine: "pglite",
      targetSchema: "public",
      targetTable: "docs",
      columns,
      rows: dataRows,
    });

    const rs = await driver.query(session, "select description from docs order by id");
    expect(rs.rows[0][0]).toBe("hello, world");
    expect(rs.rows[1][0]).toBe('she said "hi"');
    expect(rs.rows[2][0]).toContain("line1");
    expect(rs.rows[2][0]).toContain("line2");
  });

  it("strips UTF-8 BOM from CSV input", () => {
    const rows = parseCsv(CSV_BOM);
    expect(rows[0][0]).toBe("id"); // BOM stripped; header is "id" not "﻿id"
  });

  it("reports progress callbacks with correct counts", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    const rows = parseCsv(CSV_BASIC);
    const [headers, ...dataRows] = rows;
    const columns = headers.map((name) => ({ name, type: "text" as const }));

    const progress: Array<[number, number]> = [];
    await importCsvIntoTable({
      manager: fakeManager(driver, session),
      profileId: "m",
      engine: "pglite",
      targetSchema: "public",
      targetTable: "prog",
      columns,
      rows: dataRows,
      batchSize: 2,
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect(progress.length).toBeGreaterThan(0);
    const [lastDone, lastTotal] = progress[progress.length - 1];
    expect(lastDone).toBe(3);
    expect(lastTotal).toBe(3);
  });

  it("aborts import mid-batch when signal is aborted", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    const manyRows = Array.from({ length: 10 }, (_, i) => [`${i}`, `row${i}`]);
    const columns = [
      { name: "id", type: "integer" as const },
      { name: "label", type: "text" as const },
    ];

    const controller = new AbortController();
    // Abort immediately — the first batch check should catch it.
    controller.abort();

    await expect(
      importCsvIntoTable({
        manager: fakeManager(driver, session),
        profileId: "m",
        engine: "pglite",
        targetSchema: "public",
        targetTable: "aborted",
        columns,
        rows: manyRows,
        batchSize: 3,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("CREATE TABLE is idempotent (IF NOT EXISTS)", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    const columns = [{ name: "n", type: "integer" as const }];
    const rows = [["1"]];

    // First import creates the table.
    await importCsvIntoTable({
      manager: fakeManager(driver, session),
      profileId: "m",
      engine: "pglite",
      targetSchema: "public",
      targetTable: "idempotent",
      columns,
      rows,
    });

    // Second import appends without recreating — should not throw.
    const r2 = await importCsvIntoTable({
      manager: fakeManager(driver, session),
      profileId: "m",
      engine: "pglite",
      targetSchema: "public",
      targetTable: "idempotent",
      columns,
      rows: [["2"]],
    });

    expect(r2.rowsInserted).toBe(1);
    const rs = await driver.query(session, "select count(*) from idempotent");
    expect(Number((rs.rows[0] as unknown[])[0])).toBe(2);
  });
});

// ─── SQLite E2E ───────────────────────────────────────────────────────────────

describe("CSV → SQLite E2E", () => {
  const driver = new SqliteDriver();
  let session: Session | undefined;

  afterEach(async () => {
    if (session) {
      await driver.dispose(session);
      session = undefined;
    }
  });

  it("imports basic CSV and verifies data types", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "sqlite" });
    const rows = parseCsv(CSV_BASIC);
    const [headers, ...dataRows] = rows;
    const types = inferTypes(dataRows);
    const columns = headers.map((name, i) => ({ name, type: types[i] }));

    const result = await importCsvIntoTable({
      manager: fakeManager(driver, session),
      profileId: "m",
      engine: "sqlite",
      targetTable: "people",
      columns,
      rows: dataRows,
    });

    expect(result.rowsInserted).toBe(3);

    const rs = await driver.query(session, "select id, name, active from people order by id");
    expect(rs.rows[0][0]).toBe(1);
    expect(rs.rows[0][1]).toBe("Ada");
    // SQLite boolean stored as INTEGER: 1/0
    expect(rs.rows[0][2]).toBe(1);
    expect(rs.rows[1][2]).toBe(0);
  });

  it("handles NULL (empty CSV field) correctly in SQLite", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "sqlite" });
    const rows = parseCsv("a,b\n1,\n2,hello\n");
    const [headers, ...dataRows] = rows;
    const types = inferTypes(dataRows);
    const columns = headers.map((name, i) => ({ name, type: types[i] }));

    await importCsvIntoTable({
      manager: fakeManager(driver, session),
      profileId: "m",
      engine: "sqlite",
      targetTable: "nulls",
      columns,
      rows: dataRows,
    });

    const rs = await driver.query(session, "select b from nulls order by a");
    expect(rs.rows[0][0]).toBeNull();
    expect(rs.rows[1][0]).toBe("hello");
  });

  it("batches correctly — row count matches across multiple batches", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "sqlite" });
    const bigRows = Array.from({ length: 50 }, (_, i) => [`${i}`]);
    const columns = [{ name: "id", type: "integer" as const }];

    const result = await importCsvIntoTable({
      manager: fakeManager(driver, session),
      profileId: "m",
      engine: "sqlite",
      targetTable: "big",
      columns,
      rows: bigRows,
      batchSize: 7,
    });

    expect(result.rowsInserted).toBe(50);
    const rs = await driver.query(session, "select count(*) as n from big");
    expect(Number(rs.rows[0][0])).toBe(50);
  });
});
