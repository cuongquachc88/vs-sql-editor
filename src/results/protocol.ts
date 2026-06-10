import type { ResultSet } from "../drivers/types";

// Host -> Webview
export type HostMessage =
  | { type: "result"; data: ResultSet }
  | { type: "error"; message: string; detail?: string }
  | { type: "loading"; sql: string };

// Webview -> Host
export type WebviewMessage =
  | { type: "requestPage"; page: number }
  | { type: "export"; format: "csv" | "json" };

export function isWebviewMessage(m: unknown): m is WebviewMessage {
  if (!m || typeof m !== "object") return false;
  const t = (m as { type?: unknown }).type;
  if (t === "requestPage") return typeof (m as { page?: unknown }).page === "number";
  if (t === "export") {
    const f = (m as { format?: unknown }).format;
    return f === "csv" || f === "json";
  }
  return false;
}
