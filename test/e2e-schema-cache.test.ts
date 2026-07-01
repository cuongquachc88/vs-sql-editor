// E2E: SchemaCache wired to a real PGlite driver — verifies lazy loading,
// cache invalidation, and fresh data after schema changes.
import { describe, it, expect, afterEach } from "vitest";
import { PgliteDriver } from "../src/drivers/pglite";
import { SchemaCache } from "../src/connections/schema-cache";
import type { Session } from "../src/drivers/types";

describe("SchemaCache + PGlite E2E", () => {
  const driver = new PgliteDriver();
  let session: Session | undefined;

  afterEach(async () => {
    if (session) {
      await driver.dispose(session);
      session = undefined;
    }
  });

  it("lazily introspects and caches the schema model", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    await driver.query(session, "create table widgets (id int primary key, name text)");

    let callCount = 0;
    const cache = new SchemaCache(async () => {
      callCount++;
      return driver.introspect(session!);
    });

    expect(cache.peek("m")).toBeUndefined();

    const m1 = await cache.get("m");
    const m2 = await cache.get("m");

    expect(callCount).toBe(1);      // only introspected once
    expect(m1).toBe(m2);            // same reference (cached)

    const pub = m1.databases[0].schemas.find((s) => s.name === "public")!;
    expect(pub.tables.some((t) => t.name === "widgets")).toBe(true);
  });

  it("returns stale data until invalidated, then reflects new table", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });

    const cache = new SchemaCache(async () => driver.introspect(session!));

    // Introspect before creating the table.
    const before = await cache.get("m");
    const pubBefore = before.databases[0].schemas.find((s) => s.name === "public")!;
    expect(pubBefore.tables).toHaveLength(0);

    // Create a table — cache still holds stale data.
    await driver.query(session, "create table new_tbl (id int)");
    const stale = cache.peek("m");
    expect(stale!.databases[0].schemas[0].tables).toHaveLength(0);

    // Invalidate and re-fetch — now sees new_tbl.
    cache.invalidate("m");
    const fresh = await cache.get("m");
    const pubFresh = fresh.databases[0].schemas.find((s) => s.name === "public")!;
    expect(pubFresh.tables.some((t) => t.name === "new_tbl")).toBe(true);
  });
});
