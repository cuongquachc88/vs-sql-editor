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
});
