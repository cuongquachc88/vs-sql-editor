import { describe, it, expect, vi } from "vitest";
import { SchemaCache } from "./schema-cache";
import type { SchemaModel } from "../drivers/types";

const MODEL_A: SchemaModel = { databases: [{ name: "a", schemas: [] }] };
const MODEL_B: SchemaModel = { databases: [{ name: "b", schemas: [] }] };

describe("SchemaCache", () => {
  it("calls introspectFn once and caches result for the same profile", async () => {
    const fn = vi.fn(async () => MODEL_A);
    const cache = new SchemaCache(fn);

    const r1 = await cache.get("p1");
    const r2 = await cache.get("p1");

    expect(r1).toBe(MODEL_A);
    expect(r2).toBe(MODEL_A);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("calls introspectFn separately for different profiles", async () => {
    const fn = vi.fn(async (id: string) =>
      id === "p1" ? MODEL_A : MODEL_B,
    );
    const cache = new SchemaCache(fn);

    const r1 = await cache.get("p1");
    const r2 = await cache.get("p2");

    expect(r1).toBe(MODEL_A);
    expect(r2).toBe(MODEL_B);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("peek returns undefined before any introspection", () => {
    const cache = new SchemaCache(vi.fn());
    expect(cache.peek("p1")).toBeUndefined();
  });

  it("peek returns cached model after get", async () => {
    const cache = new SchemaCache(vi.fn(async () => MODEL_A));
    await cache.get("p1");
    expect(cache.peek("p1")).toBe(MODEL_A);
  });

  it("invalidate(id) clears only that profile", async () => {
    const fn = vi.fn(async () => MODEL_A);
    const cache = new SchemaCache(fn);

    await cache.get("p1");
    await cache.get("p2");
    cache.invalidate("p1");

    expect(cache.peek("p1")).toBeUndefined();
    expect(cache.peek("p2")).toBe(MODEL_A);

    // p1 re-introspected on next get
    await cache.get("p1");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("invalidate() with no argument clears all profiles", async () => {
    const cache = new SchemaCache(vi.fn(async () => MODEL_A));
    await cache.get("p1");
    await cache.get("p2");

    cache.invalidate();

    expect(cache.peek("p1")).toBeUndefined();
    expect(cache.peek("p2")).toBeUndefined();
  });

  it("returns fresh data after invalidation", async () => {
    let call = 0;
    const cache = new SchemaCache(async () => (call++ === 0 ? MODEL_A : MODEL_B));

    const r1 = await cache.get("p1");
    cache.invalidate("p1");
    const r2 = await cache.get("p1");

    expect(r1).toBe(MODEL_A);
    expect(r2).toBe(MODEL_B);
  });
});
