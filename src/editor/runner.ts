import { ResultsPanel } from "../results/panel";
import { toCsv } from "../export/csv";
import { toJson } from "../export/json";
import { DriverError, type ResultSet } from "../drivers/types";
import type { ConnectionManager } from "../connections/manager";

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
}

// Runs `sql`, drives the panel, and wires paging + export for this result.
export async function runAndShow(ctx: RunContext, sql: string): Promise<void> {
  const { manager, profileId, pageSize, panel } = ctx;

  const runPage = async (page: number): Promise<ResultSet | undefined> => {
    try {
      panel.post({ type: "loading", sql });
      const session = await manager.get(profileId);
      const driver = manager.driverOf(profileId)!;
      const rs = await driver.query(session, sql, { page, pageSize });
      panel.post({ type: "result", data: rs });
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
    }
  });
}
