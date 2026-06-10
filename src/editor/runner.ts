import { ResultsPanel } from "../results/panel";
import { toCsv } from "../export/csv";
import { toJson } from "../export/json";
import { DriverError, type ResultSet } from "../drivers/types";
import type { ConnectionManager } from "../connections/manager";
import type { EditMeta } from "../results/protocol";

// Pure: choose the SQL to execute.
export function resolveSql(documentText: string, selectedText: string): string {
  const sel = selectedText.trim();
  return sel.length > 0 ? sel : documentText.trim();
}

export interface RunContext {
  manager: ConnectionManager;
  profileId: string;
  pageSize: number;
  panel: ResultsPanel;
  // When set, the result rows map to this table and the grid allows inline edits.
  edit?: EditMeta;
}

// Runs `sql`, drives the panel, and wires paging + export + inline edit for this result.
export async function runAndShow(ctx: RunContext, sql: string): Promise<void> {
  const { manager, profileId, pageSize, panel, edit } = ctx;
  let currentPage = 0;

  const runPage = async (page: number): Promise<ResultSet | undefined> => {
    try {
      panel.post({ type: "loading", sql });
      const session = await manager.get(profileId);
      const driver = manager.driverOf(profileId)!;
      const rs = await driver.query(session, sql, { page, pageSize });
      currentPage = page;
      panel.post({ type: "result", data: rs, edit });
      return rs;
    } catch (err) {
      const e = DriverError.from(err);
      panel.post({ type: "error", message: e.message, detail: e.detail });
      return undefined;
    }
  };

  let last = await runPage(0);

  panel.setMessageHandler(async (m) => {
    if (m.type === "requestPage") {
      last = await runPage(m.page);
      return;
    }
    if (m.type === "export" && last) {
      const text = m.format === "csv" ? toCsv(last) : toJson(last);
      const { window, workspace, Uri } = await import("vscode");
      const target = await window.showSaveDialog({
        filters: m.format === "csv" ? { CSV: ["csv"] } : { JSON: ["json"] },
      });
      if (target) {
        await workspace.fs.writeFile(target, Buffer.from(text, "utf8"));
        void window.showInformationMessage(`Exported to ${Uri.from(target).fsPath}`);
      }
      return;
    }
    if (m.type === "applyEdit" && edit) {
      const { window } = await import("vscode");
      const driver = manager.driverOf(profileId);
      if (!driver) return;
      let statement: string;
      try {
        statement = driver.buildEditStatement(edit.table, m.pk, { [m.column]: m.value });
      } catch (err) {
        void window.showErrorMessage(`Cannot build update: ${(err as Error).message}`);
        if (last) panel.post({ type: "result", data: last, edit }); // revert grid
        return;
      }
      const choice = await window.showWarningMessage(
        `Apply this change?\n\n${statement}`,
        { modal: true },
        "Run Update",
      );
      if (choice !== "Run Update") {
        if (last) panel.post({ type: "result", data: last, edit }); // revert grid
        return;
      }
      try {
        const session = await manager.get(profileId);
        await driver.query(session, statement);
        void window.showInformationMessage("Row updated.");
      } catch (err) {
        const e = DriverError.from(err);
        void window.showErrorMessage(`Update failed: ${e.message}`);
      }
      last = await runPage(currentPage); // refresh to show the committed value
    }
  });
}
