import { describe, it, expect } from "vitest";
import { Memento } from "../../test/vscode-mock";
import { ErdLayoutStore } from "./layout-store";

describe("ErdLayoutStore", () => {
  it("round-trips a layout per profile id", async () => {
    const store = new ErdLayoutStore(new Memento() as never);
    expect(store.get("p1")).toEqual({});
    await store.save("p1", { "public|users": { x: 100, y: 200 } });
    expect(store.get("p1")).toEqual({ "public|users": { x: 100, y: 200 } });
  });
  it("isolates layouts across profiles", async () => {
    const store = new ErdLayoutStore(new Memento() as never);
    await store.save("p1", { a: { x: 1, y: 2 } });
    await store.save("p2", { b: { x: 3, y: 4 } });
    expect(store.get("p1")).toEqual({ a: { x: 1, y: 2 } });
    expect(store.get("p2")).toEqual({ b: { x: 3, y: 4 } });
  });
  it("clear removes a layout", async () => {
    const store = new ErdLayoutStore(new Memento() as never);
    await store.save("p1", { a: { x: 1, y: 2 } });
    await store.clear("p1");
    expect(store.get("p1")).toEqual({});
  });
});
