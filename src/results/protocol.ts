import type { ResultSet } from "../drivers/types";

// Present on a result when its rows map to a single base table that can be edited.
export interface EditMeta {
  table: string; // qualified, quoted table reference
  pkColumns: string[]; // primary key column names (used to target a row)
}

export interface ResultMeta {
  executionMs: number;
  // Display label for the connection used (shown in the results status bar).
  connectionLabel?: string;
}

// Host -> Webview
export type HostMessage =
  | { type: "result"; data: ResultSet; edit?: EditMeta; meta?: ResultMeta }
  | { type: "error"; message: string; detail?: string }
  | { type: "loading"; sql: string };

// Webview -> Host
export type WebviewMessage =
  | { type: "requestPage"; page: number }
  | { type: "export"; format: "csv" | "json" }
  | { type: "applyEdit"; pk: Record<string, unknown>; column: string; value: string }
  | { type: "setPageSize"; pageSize: number }
  | { type: "saveQuery"; sql: string };

export function isWebviewMessage(m: unknown): m is WebviewMessage {
  if (!m || typeof m !== "object") return false;
  const t = (m as { type?: unknown }).type;
  if (t === "requestPage") return typeof (m as { page?: unknown }).page === "number";
  if (t === "export") {
    const f = (m as { format?: unknown }).format;
    return f === "csv" || f === "json";
  }
  if (t === "applyEdit") {
    const e = m as { pk?: unknown; column?: unknown };
    return typeof e.column === "string" && !!e.pk && typeof e.pk === "object";
  }
  if (t === "setPageSize") return typeof (m as { pageSize?: unknown }).pageSize === "number";
  if (t === "saveQuery") return typeof (m as { sql?: unknown }).sql === "string";
  return false;
}
