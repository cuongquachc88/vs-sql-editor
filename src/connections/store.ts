import type { ExtensionContext } from "vscode";
import type { ConnectionProfile, EngineId } from "../drivers/types";

const KEY = "vsSqlEditor.connections";
const secretKey = (id: string) => `vsSqlEditor.secret.${id}`;

type NewProfile = Omit<ConnectionProfile, "id">;

export class ConnectionStore {
  constructor(
    private readonly state: ExtensionContext["globalState"],
    private readonly secrets: ExtensionContext["secrets"],
  ) {}

  list(): ConnectionProfile[] {
    return this.state.get<ConnectionProfile[]>(KEY, []) ?? [];
  }

  get(id: string): ConnectionProfile | undefined {
    return this.list().find((p) => p.id === id);
  }

  async add(profile: NewProfile, secret?: string): Promise<ConnectionProfile> {
    const id = `${profile.engine}-${Date.now()}-${Math.round(performance.now())}`;
    const full: ConnectionProfile = { ...profile, id };
    await this.state.update(KEY, [...this.list(), full]);
    if (secret) await this.secrets.store(secretKey(id), secret);
    return full;
  }

  // engine is intentionally immutable on update — changing the driver is a different
  // operation (duplicate as new). Pass secret to set/replace the stored secret,
  // pass null to delete it, omit (undefined) to leave it alone.
  async update(
    id: string,
    patch: Partial<Omit<ConnectionProfile, "id" | "engine">>,
    secret?: string | null,
  ): Promise<ConnectionProfile> {
    const all = this.list();
    const idx = all.findIndex((p) => p.id === id);
    if (idx < 0) throw new Error(`Unknown connection: ${id}`);
    const merged: ConnectionProfile = { ...all[idx], ...patch, id, engine: all[idx].engine };
    const next = [...all];
    next[idx] = merged;
    await this.state.update(KEY, next);
    if (secret === null) await this.secrets.delete(secretKey(id));
    else if (typeof secret === "string") await this.secrets.store(secretKey(id), secret);
    return merged;
  }

  async remove(id: string): Promise<void> {
    await this.state.update(
      KEY,
      this.list().filter((p) => p.id !== id),
    );
    await this.secrets.delete(secretKey(id));
  }

  getSecret(id: string): Promise<string | undefined> {
    return Promise.resolve(this.secrets.get(secretKey(id)));
  }
}

export type { EngineId };
