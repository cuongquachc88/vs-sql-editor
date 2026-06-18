import type { EngineId } from "../drivers/types";

export interface WelcomeConnection {
  id: string;
  name: string;
  engine: EngineId;
  host?: string;
  filePath?: string;
  database?: string;
}

export interface WelcomeRecent {
  profileId: string;
  profileName: string;
  sql: string;
  at: number;
  ok: boolean;
}

export type HostMessage = {
  type: "state";
  connections: WelcomeConnection[];
  recents: WelcomeRecent[];
  activeId: string | undefined;
};

export type WebviewMessage =
  | { type: "ready" }
  | { type: "addConnection" }
  | { type: "openConnection"; profileId: string } // set active + focus sidebar
  | { type: "openQuery"; sql: string; profileId?: string } // open editor with this SQL, optionally switch connection
  | { type: "openSample"; engine: EngineId }
  | { type: "clearRecents" };

export function isWebviewMessage(m: unknown): m is WebviewMessage {
  if (!m || typeof m !== "object") return false;
  const t = (m as { type?: unknown }).type;
  switch (t) {
    case "ready":
    case "addConnection":
    case "clearRecents":
      return true;
    case "openConnection":
      return typeof (m as { profileId?: unknown }).profileId === "string";
    case "openSample":
      return typeof (m as { engine?: unknown }).engine === "string";
    case "openQuery":
      return typeof (m as { sql?: unknown }).sql === "string";
    default:
      return false;
  }
}
