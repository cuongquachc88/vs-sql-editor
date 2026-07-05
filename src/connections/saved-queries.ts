import type { ExtensionContext } from "vscode";

const KEY = "vsSqlEditor.savedQueries";

export interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  profileId?: string;
  profileName?: string;
  createdAt: number;
}

export class SavedQueries {
  constructor(private readonly state: ExtensionContext["globalState"]) {}

  list(): SavedQuery[] {
    return this.state.get<SavedQuery[]>(KEY, []) ?? [];
  }

  async save(entry: Omit<SavedQuery, "id" | "createdAt">): Promise<SavedQuery> {
    const saved: SavedQuery = {
      ...entry,
      id: `sq-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      createdAt: Date.now(),
    };
    const existing = this.list();
    await this.state.update(KEY, [saved, ...existing]);
    return saved;
  }

  async remove(id: string): Promise<void> {
    const next = this.list().filter((q) => q.id !== id);
    await this.state.update(KEY, next);
  }

  async rename(id: string, name: string): Promise<void> {
    const next = this.list().map((q) => (q.id === id ? { ...q, name } : q));
    await this.state.update(KEY, next);
  }

  async clear(): Promise<void> {
    await this.state.update(KEY, []);
  }
}
