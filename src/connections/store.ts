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
