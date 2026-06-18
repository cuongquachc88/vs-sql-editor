import type { ColumnMeta } from "../drivers/types";

// MIME type for our custom result output. The renderer (sqlnb-renderer.js)
// claims this mime in package.json.
export const RESULT_MIME = "application/x-vssqleditor-result+json";
export const ERROR_MIME = "application/x-vssqleditor-error+json";

export interface NotebookResultPayload {
  columns: ColumnMeta[];
  rows: unknown[][];
  totalRowsHint?: number;
  page: number;
  pageSize: number;
  hasMore?: boolean;
  executionMs: number;
  rowCount?: number;
  connectionLabel?: string;
  // Stable id so the renderer can post export messages tied to this output.
  resultId: string;
}

export interface NotebookErrorPayload {
  message: string;
  detail?: string;
}

// Renderer -> Controller (via NotebookRendererMessaging)
export type RendererMessage =
  | { type: "exportCsv"; resultId: string }
  | { type: "exportJson"; resultId: string };

// On-disk format for a .sqlnb cell.
export interface SqlNotebookCell {
  kind: "code" | "markdown";
  language: string;
  value: string;
}
export interface SqlNotebookData {
  cells: SqlNotebookCell[];
}
