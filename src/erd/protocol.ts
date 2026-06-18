import type { EngineId, SchemaModel } from "../drivers/types";

export interface NodePosition {
  x: number;
  y: number;
}

export type LayoutMap = Record<string, NodePosition>; // key: "schema|table"

// Host -> Webview
export type HostMessage =
  | {
      type: "state";
      connectionName: string;
      engine: EngineId;
      model: SchemaModel;
      layout: LayoutMap;
    }
  | { type: "schemaError"; message: string };

// Webview -> Host
export type WebviewMessage =
  | { type: "ready" }
  | { type: "saveLayout"; layout: LayoutMap }
  | {
      type: "openTable";
      database: string;
      schema: string;
      table: string;
      isView: boolean;
    }
  | { type: "resetLayout" };

export function isWebviewMessage(m: unknown): m is WebviewMessage {
  if (!m || typeof m !== "object") return false;
  const t = (m as { type?: unknown }).type;
  if (t === "ready" || t === "resetLayout") return true;
  if (t === "saveLayout") return typeof (m as { layout?: unknown }).layout === "object";
  if (t === "openTable") {
    const x = m as Record<string, unknown>;
    return (
      typeof x.database === "string" &&
      typeof x.schema === "string" &&
      typeof x.table === "string" &&
      typeof x.isView === "boolean"
    );
  }
  return false;
}
