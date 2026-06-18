import { describe, it, expect } from "vitest";
import { Memento } from "../../test/vscode-mock";
import { RecentQueries, type RecentQuery } from "./recent-queries";

function entry(sql: string, profileId = "p", profileName = "Local"): RecentQuery {
  return { sql, profileId, profileName, at: Date.now(), ok: true };
}

describe("RecentQueries", () => {
  it("adds entries newest-first", async () => {
    const r = new RecentQueries(new Memento() as never);
    await r.add(entry("select 1"));
    await r.add(entry("select 2"));
    expect(r.list().map((e) => e.sql)).toEqual(["select 2", "select 1"]);
  });

  it("de-dupes the same SQL within the same profile", async () => {
    const r = new RecentQueries(new Memento() as never);
    await r.add(entry("select 1"));
    await r.add(entry("select 2"));
    await r.add(entry("select 1"));
    expect(r.list().map((e) => e.sql)).toEqual(["select 1", "select 2"]);
  });

  it("keeps separate entries for the same SQL on different profiles", async () => {
    const r = new RecentQueries(new Memento() as never);
    await r.add(entry("select 1", "p1", "A"));
    await r.add(entry("select 1", "p2", "B"));
    expect(r.list()).toHaveLength(2);
  });

  it("caps at 20 (oldest evicted)", async () => {
    const r = new RecentQueries(new Memento() as never);
    for (let i = 0; i < 25; i++) await r.add(entry(`select ${i}`));
    const list = r.list();
    expect(list).toHaveLength(20);
    expect(list[0].sql).toBe("select 24");
    expect(list[list.length - 1].sql).toBe("select 5");
  });

  it("clear empties the list", async () => {
    const r = new RecentQueries(new Memento() as never);
    await r.add(entry("x"));
    await r.clear();
    expect(r.list()).toEqual([]);
  });
});
