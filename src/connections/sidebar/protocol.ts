import type { EngineId, SchemaModel } from "../../drivers/types";

export interface ConnectionSummary {
  id: string;
  name: string;
  engine: EngineId;
  host?: string;
  filePath?: string;
  database?: string;
}

// Host -> Webview
export type HostMessage =
  | {
      type: "state";
      connections: ConnectionSummary[];
      activeId: string | undefined;
      liveIds: string[];
      // Persisted expand state restored from globalState.
      openConnections?: string[];
      openNodes?: string[];
    }
  | {
      type: "schema";
      profileId: string;
      model: SchemaModel | null;
      error?: string;
    }
  | { type: "activeChanged"; activeId: string | undefined }
  | { type: "liveChanged"; liveIds: string[] };

// Webview -> Host
export type WebviewMessage =
  | { type: "ready" }
  | { type: "addConnection" }
  | { type: "newQuery"; profileId?: string }
  | { type: "setActive"; profileId: string }
  | { type: "edit"; profileId: string }
  | { type: "duplicate"; profileId: string }
  | { type: "delete"; profileId: string }
  | { type: "refresh" }
  | { type: "loadSchema"; profileId: string }
  | { type: "expandedChanged"; openConnections: string[]; openNodes: string[] }
  | {
      type: "previewTable";
      profileId: string;
      database: string;
      schema: string;
      table: string;
      isView: boolean;
    }
  | { type: "createDatabase"; profileId: string }
  | { type: "createSchema"; profileId: string; database: string }
  | { type: "createTable"; profileId: string; database: string; schema: string }
  | {
      type: "editTable";
      profileId: string;
      database: string;
      schema: string;
      table: string;
    }
  | {
      type: "dropTable";
      profileId: string;
      database: string;
      schema: string;
      table: string;
      isView: boolean;
    };

export function isWebviewMessage(m: unknown): m is WebviewMessage {
  if (!m || typeof m !== "object") return false;
  const t = (m as { type?: unknown }).type;
  switch (t) {
    case "ready":
    case "addConnection":
    case "refresh":
      return true;
    case "expandedChanged":
      return (
        Array.isArray((m as { openConnections?: unknown }).openConnections) &&
        Array.isArray((m as { openNodes?: unknown }).openNodes)
      );
    case "newQuery": {
      const id = (m as { profileId?: unknown }).profileId;
      return id === undefined || typeof id === "string";
    }
    case "setActive":
    case "edit":
    case "duplicate":
    case "delete":
    case "loadSchema":
    case "createDatabase":
      return typeof (m as { profileId?: unknown }).profileId === "string";
    case "createSchema": {
      const x = m as Record<string, unknown>;
      return typeof x.profileId === "string" && typeof x.database === "string";
    }
    case "createTable": {
      const x = m as Record<string, unknown>;
      return (
        typeof x.profileId === "string" &&
        typeof x.database === "string" &&
        typeof x.schema === "string"
      );
    }
    case "editTable": {
      const x = m as Record<string, unknown>;
      return (
        typeof x.profileId === "string" &&
        typeof x.database === "string" &&
        typeof x.schema === "string" &&
        typeof x.table === "string"
      );
    }
    case "dropTable":
    case "previewTable": {
      const x = m as Record<string, unknown>;
      return (
        typeof x.profileId === "string" &&
        typeof x.database === "string" &&
        typeof x.schema === "string" &&
        typeof x.table === "string" &&
        typeof x.isView === "boolean"
      );
    }
    default:
      return false;
  }
}
