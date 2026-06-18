import type { EngineId } from "../drivers/types";
import type { InferredType } from "./sql-types";

export interface ImportColumn {
  name: string;
  type: InferredType;
}

// Host -> Webview
export type HostMessage =
  | {
      type: "ready";
      connectionName: string;
      engine: EngineId;
      schemas: string[]; // multi-schema engines list them; single-schema engines pass []
    }
  | {
      type: "preview";
      filename: string;
      filePath: string;
      headerRow: string[];
      sampleRows: string[][];
      totalRows: number;
      inferred: ImportColumn[];
      defaultTableName: string;
    }
  | {
      type: "progress";
      done: number;
      total: number;
    }
  | {
      type: "done";
      rowsInserted: number;
      targetTable: string;
      targetSchema?: string;
    }
  | { type: "error"; message: string };

// Webview -> Host
export type WebviewMessage =
  | { type: "ready" }
  | { type: "pickFile" }
  | {
      type: "runImport";
      filePath: string;
      targetSchema?: string;
      targetTable: string;
      columns: ImportColumn[];
    }
  | { type: "cancel" };

export function isWebviewMessage(m: unknown): m is WebviewMessage {
  if (!m || typeof m !== "object") return false;
  const t = (m as { type?: unknown }).type;
  if (t === "ready" || t === "pickFile" || t === "cancel") return true;
  if (t === "runImport") {
    const x = m as Record<string, unknown>;
    return (
      typeof x.filePath === "string" &&
      typeof x.targetTable === "string" &&
      Array.isArray(x.columns)
    );
  }
  return false;
}
