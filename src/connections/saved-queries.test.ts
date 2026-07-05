import { describe, it, expect, beforeEach } from "vitest";
import { SavedQueries } from "./saved-queries";

function makeState() {
  const store = new Map<string, unknown>();
  return {
    get: <T>(key: string, fallback: T): T => (store.has(key) ? (store.get(key) as T) : fallback),
    update: async (key: string, value: unknown) => { store.set(key, value); },
    keys: () => [...store.keys()],
    setKeysForSync: () => {},
  } as unknown as import("vscode").Memento & { setKeysForSync(keys: readonly string[]): void };
}

describe("SavedQueries", () => {
  let sq: SavedQueries;

  beforeEach(() => {
    sq = new SavedQueries(makeState());
  });

  it("starts empty", () => {
    expect(sq.list()).toEqual([]);
  });

  it("saves a query and assigns an id", async () => {
    const saved = await sq.save({ name: "My query", sql: "SELECT 1" });
    expect(saved.id).toMatch(/^sq-/);
    expect(saved.name).toBe("My query");
    expect(saved.sql).toBe("SELECT 1");
    expect(sq.list()).toHaveLength(1);
  });

  it("prepends new entries (newest first)", async () => {
    await sq.save({ name: "First", sql: "SELECT 1" });
    await sq.save({ name: "Second", sql: "SELECT 2" });
    const list = sq.list();
    expect(list[0].name).toBe("Second");
    expect(list[1].name).toBe("First");
  });

  it("removes by id", async () => {
    const a = await sq.save({ name: "A", sql: "SELECT 'a'" });
    await sq.save({ name: "B", sql: "SELECT 'b'" });
    await sq.remove(a.id);
    const list = sq.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("B");
  });

  it("renames by id", async () => {
    const q = await sq.save({ name: "Old name", sql: "SELECT 42" });
    await sq.rename(q.id, "New name");
    expect(sq.list()[0].name).toBe("New name");
    expect(sq.list()[0].sql).toBe("SELECT 42");
  });

  it("clear removes all entries", async () => {
    await sq.save({ name: "X", sql: "SELECT 'x'" });
    await sq.save({ name: "Y", sql: "SELECT 'y'" });
    await sq.clear();
    expect(sq.list()).toHaveLength(0);
  });

  it("stores optional profileId and profileName", async () => {
    const saved = await sq.save({
      name: "Prod query",
      sql: "SELECT count(*) FROM users",
      profileId: "pg-123",
      profileName: "Production",
    });
    expect(saved.profileId).toBe("pg-123");
    expect(saved.profileName).toBe("Production");
  });
});
