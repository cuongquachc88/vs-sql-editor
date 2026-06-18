import * as vscode from "vscode";
import type { SqlNotebookCell, SqlNotebookData } from "./protocol";

// JSON-based serializer for .sqlnb files. The on-disk format is the smallest
// JSON shape we can get away with; outputs are NOT persisted (re-run to refill).
export class SqlNotebookSerializer implements vscode.NotebookSerializer {
  async deserializeNotebook(
    content: Uint8Array,
    _token: vscode.CancellationToken,
  ): Promise<vscode.NotebookData> {
    void _token;
    const text = Buffer.from(content).toString("utf-8").trim();
    let parsed: SqlNotebookData;
    if (!text) {
      parsed = { cells: [defaultCell()] };
    } else {
      try {
        parsed = JSON.parse(text) as SqlNotebookData;
      } catch {
        parsed = { cells: [{ kind: "code", language: "sql", value: text }] };
      }
    }
    const cells = (parsed.cells ?? []).map((c) => {
      const kind =
        c.kind === "markdown"
          ? vscode.NotebookCellKind.Markup
          : vscode.NotebookCellKind.Code;
      return new vscode.NotebookCellData(kind, c.value ?? "", c.language || "sql");
    });
    return new vscode.NotebookData(cells.length ? cells : [toCellData(defaultCell())]);
  }

  async serializeNotebook(
    data: vscode.NotebookData,
    _token: vscode.CancellationToken,
  ): Promise<Uint8Array> {
    void _token;
    const out: SqlNotebookData = {
      cells: data.cells.map((c) => ({
        kind: c.kind === vscode.NotebookCellKind.Markup ? "markdown" : "code",
        language: c.languageId || (c.kind === vscode.NotebookCellKind.Markup ? "markdown" : "sql"),
        value: c.value,
      })),
    };
    return Buffer.from(JSON.stringify(out, null, 2) + "\n", "utf-8");
  }
}

function defaultCell(): SqlNotebookCell {
  return {
    kind: "code",
    language: "sql",
    value: "-- Write SQL here, then click ▶ to run.\n-- The result grid appears below this cell.\nselect 1 as hello;\n",
  };
}

function toCellData(c: SqlNotebookCell): vscode.NotebookCellData {
  const kind =
    c.kind === "markdown" ? vscode.NotebookCellKind.Markup : vscode.NotebookCellKind.Code;
  return new vscode.NotebookCellData(kind, c.value, c.language || "sql");
}
