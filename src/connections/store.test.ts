import { describe, it, expect } from "vitest";
import { Memento, SecretStorage } from "../../test/vscode-mock";
import { ConnectionStore } from "./store";

function makeStore() {
  return new ConnectionStore(new Memento() as any, new SecretStorage() as any);
}

describe("ConnectionStore", () => {
  it("saves and lists a profile without storing the secret in globalState", async () => {
    const store = makeStore();
    const profile = await store.add(
      { name: "local", engine: "postgres", host: "localhost", port: 5432, database: "app", user: "me" },
      "s3cret",
    );
    expect(profile.id).toBeTruthy();
    expect(store.list()).toHaveLength(1);
    expect(JSON.stringify(store.list())).not.toContain("s3cret");
    expect(await store.getSecret(profile.id)).toBe("s3cret");
  });

  it("removes a profile and its secret", async () => {
    const store = makeStore();
    const p = await store.add({ name: "x", engine: "postgres" }, "pw");
    await store.remove(p.id);
    expect(store.list()).toHaveLength(0);
    expect(await store.getSecret(p.id)).toBeUndefined();
  });

  it("updates fields without touching the secret when secret arg is omitted", async () => {
    const store = makeStore();
    const p = await store.add({ name: "a", engine: "postgres", host: "h1" }, "pw");
    const updated = await store.update(p.id, { name: "b", host: "h2" });
    expect(updated.name).toBe("b");
    expect(updated.host).toBe("h2");
    expect(updated.id).toBe(p.id);
    expect(updated.engine).toBe("postgres");
    expect(await store.getSecret(p.id)).toBe("pw");
  });

  it("replaces the secret when a new one is provided", async () => {
    const store = makeStore();
    const p = await store.add({ name: "a", engine: "postgres" }, "old");
    await store.update(p.id, { name: "a2" }, "new");
    expect(await store.getSecret(p.id)).toBe("new");
  });

  it("clears the secret when passed null", async () => {
    const store = makeStore();
    const p = await store.add({ name: "a", engine: "postgres" }, "pw");
    await store.update(p.id, {}, null);
    expect(await store.getSecret(p.id)).toBeUndefined();
  });

  it("ignores any engine field in the patch", async () => {
    const store = makeStore();
    const p = await store.add({ name: "a", engine: "postgres" });
    const u = await store.update(p.id, { name: "b" } as never);
    expect(u.engine).toBe("postgres");
  });

  it("throws when updating a missing id", async () => {
    const store = makeStore();
    await expect(store.update("nope", { name: "x" })).rejects.toThrow();
  });
});
