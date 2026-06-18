import type { ExtensionContext } from "vscode";

const KEY = "vsSqlEditor.recentQueries";
const CAP = 20;

export interface RecentQuery {
  profileId: string;
  profileName: string;
  sql: string;
  at: number; // epoch ms
  ok: boolean;
}

export class RecentQueries {
  constructor(private readonly state: ExtensionContext["globalState"]) {}

  list(): RecentQuery[] {
    return this.state.get<RecentQuery[]>(KEY, []) ?? [];
  }

  // Adds an entry to the front. Caps to CAP. De-dupes by exact SQL within
  // the same profile to avoid the panel showing 20 identical rows during
  // pagination (paged re-queries land here too).
  async add(entry: RecentQuery): Promise<void> {
    const existing = this.list();
    const dedup = existing.filter(
      (e) => !(e.profileId === entry.profileId && e.sql === entry.sql),
    );
    const next = [entry, ...dedup].slice(0, CAP);
    await this.state.update(KEY, next);
  }

  async clear(): Promise<void> {
    await this.state.update(KEY, []);
  }
}
