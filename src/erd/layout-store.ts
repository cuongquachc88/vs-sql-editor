import type { ExtensionContext } from "vscode";
import type { LayoutMap } from "./protocol";

const KEY_PREFIX = "vsSqlEditor.erd.layouts.";

export class ErdLayoutStore {
  constructor(private readonly state: ExtensionContext["globalState"]) {}

  get(profileId: string): LayoutMap {
    return this.state.get<LayoutMap>(KEY_PREFIX + profileId, {}) ?? {};
  }

  async save(profileId: string, layout: LayoutMap): Promise<void> {
    await this.state.update(KEY_PREFIX + profileId, layout);
  }

  async clear(profileId: string): Promise<void> {
    await this.state.update(KEY_PREFIX + profileId, undefined);
  }
}
