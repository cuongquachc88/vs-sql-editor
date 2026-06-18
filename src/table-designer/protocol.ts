import type { EngineId } from "../drivers/types";
import type { DesignerMode, TableSchema } from "./model";

// Host -> Webview
export type HostMessage =
  | {
      type: "init";
      mode: DesignerMode;
      engine: EngineId;
      connectionName: string;
      schemas: string[]; // available schemas for the dropdown
      original: TableSchema; // for edit, the current schema; for create, an empty template
      typeCatalog: string[];
    }
  | { type: "previewSql"; sql: string }
  | { type: "saveResult"; ok: boolean; error?: string };

// Webview -> Host
export type WebviewMessage =
  | { type: "ready" }
  | { type: "requestPreview"; current: TableSchema }
  | { type: "save"; current: TableSchema }
  | { type: "cancel" };

export function isWebviewMessage(m: unknown): m is WebviewMessage {
  if (!m || typeof m !== "object") return false;
  const t = (m as { type?: unknown }).type;
  if (t === "ready" || t === "cancel") return true;
  if (t === "requestPreview" || t === "save") {
    const c = (m as { current?: unknown }).current;
    return !!c && typeof c === "object";
  }
  return false;
}
