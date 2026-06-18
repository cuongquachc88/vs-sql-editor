import * as vscode from "vscode";
import { DriverError } from "../drivers/types";
import { toCsv } from "../export/csv";
import { toJson } from "../export/json";
import type { ConnectionManager } from "../connections/manager";
import type { ConnectionStore } from "../connections/store";
import {
  ERROR_MIME,
  RESULT_MIME,
  type NotebookErrorPayload,
  type NotebookResultPayload,
  type RendererMessage,
} from "./protocol";

export const NOTEBOOK_TYPE = "vsSqlEditor.notebook";
const CONTROLLER_ID = "vsSqlEditor.controller";
const RENDERER_ID = "vsSqlEditor.resultRenderer";

interface RecentResult {
  payload: NotebookResultPayload;
}

export class SqlNotebookController {
  readonly controller: vscode.NotebookController;
  // Stash of recent result payloads so the renderer's "export" messages can
  // find them (we use resultId as the key).
  private readonly results = new Map<string, RecentResult>();

  constructor(
    context: vscode.ExtensionContext,
    private readonly store: ConnectionStore,
    private readonly manager: ConnectionManager,
    private readonly getActiveProfileId: () => string | undefined,
    private readonly setActiveProfileId: (id: string) => Promise<void>,
    private readonly defaultPageSize: () => number,
    private readonly onSessionStateChanged: () => void = () => undefined,
  ) {
    this.controller = vscode.notebooks.createNotebookController(
      CONTROLLER_ID,
      NOTEBOOK_TYPE,
      this.computeLabel(),
    );
    this.controller.description =
      "Runs SQL cells against the SQL Editor's active connection.";
    this.controller.supportedLanguages = ["sql"];
    this.controller.supportsExecutionOrder = true;
    this.controller.executeHandler = (cells, _nb, ctrl) =>
      this.execute(cells, ctrl);

    // Renderer messaging: handle "Export CSV" from inside the cell output.
    const messaging = vscode.notebooks.createRendererMessaging(RENDERER_ID);
    messaging.onDidReceiveMessage((e) => {
      void this.handleRendererMessage(e.message as RendererMessage);
    });
    context.subscriptions.push(this.controller);
  }

  // Public so the extension activator can refresh the kernel label whenever
  // the active connection changes.
  refreshLabel(): void {
    this.controller.label = this.computeLabel();
  }

  private computeLabel(): string {
    const id = this.getActiveProfileId();
    const p = id ? this.store.get(id) : undefined;
    if (!p) return "SQL — pick a connection";
    return `${p.name} · ${p.engine}`;
  }

  private async execute(
    cells: vscode.NotebookCell[],
    controller: vscode.NotebookController,
  ): Promise<void> {
    let activeId = this.getActiveProfileId();
    if (!activeId) {
      const picked = await this.pickConnection();
      if (!picked) return;
      await this.setActiveProfileId(picked);
      activeId = picked;
    }
    for (const cell of cells) {
      await this.executeCell(cell, controller, activeId);
    }
  }

  private async pickConnection(): Promise<string | undefined> {
    const items = this.store.list().map((p) => ({
      label: p.name,
      description: p.engine,
      id: p.id,
    }));
    if (items.length === 0) {
      void vscode.window.showWarningMessage(
        "No SQL connections. Add one from the SQL Editor sidebar.",
      );
      return undefined;
    }
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: "Pick a connection for this run",
    });
    return pick?.id;
  }

  private async executeCell(
    cell: vscode.NotebookCell,
    controller: vscode.NotebookController,
    profileId: string,
  ): Promise<void> {
    const exec = controller.createNotebookCellExecution(cell);
    exec.start(Date.now());
    exec.clearOutput();

    const sql = cell.document.getText().trim();
    if (!sql) {
      exec.end(true, Date.now());
      return;
    }

    const profile = this.store.get(profileId);
    if (!profile) {
      await exec.replaceOutput(
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.json(
            { message: "Active connection not found." } satisfies NotebookErrorPayload,
            ERROR_MIME,
          ),
        ]),
      );
      exec.end(false, Date.now());
      return;
    }

    try {
      const session = await this.manager.get(profileId);
      const driver = this.manager.driverOf(profileId);
      if (!driver) throw new DriverError("UNKNOWN", "Driver not loaded");
      const pageSize = this.defaultPageSize();
      const start = performance.now();
      const rs = await driver.query(session, sql, { page: 0, pageSize });
      const executionMs = Math.round(performance.now() - start);
      const resultId = `${cell.document.uri.toString()}#${Date.now()}`;
      const payload: NotebookResultPayload = {
        columns: rs.columns,
        rows: rs.rows,
        page: rs.page,
        pageSize: rs.pageSize,
        hasMore: rs.hasMore,
        rowCount: rs.rowCount,
        executionMs,
        connectionLabel: profile.name,
        resultId,
      };
      this.results.set(resultId, { payload });
      // Cap stash size — we only need results currently visible.
      if (this.results.size > 20) {
        const oldestKey = this.results.keys().next().value;
        if (oldestKey) this.results.delete(oldestKey);
      }

      await exec.replaceOutput(
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.json(payload, RESULT_MIME),
        ]),
      );
      exec.end(true, Date.now());
      this.onSessionStateChanged();
    } catch (err) {
      const e = DriverError.from(err);
      const errPayload: NotebookErrorPayload = { message: e.message, detail: e.detail };
      await exec.replaceOutput(
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.json(errPayload, ERROR_MIME),
        ]),
      );
      exec.end(false, Date.now());
      this.onSessionStateChanged();
    }
  }

  private async handleRendererMessage(m: RendererMessage): Promise<void> {
    const entry = this.results.get(m.resultId);
    if (!entry) return;
    const text = m.type === "exportCsv" ? toCsv(entry.payload) : toJson(entry.payload);
    const target = await vscode.window.showSaveDialog({
      filters: m.type === "exportCsv" ? { CSV: ["csv"] } : { JSON: ["json"] },
    });
    if (!target) return;
    await vscode.workspace.fs.writeFile(target, Buffer.from(text, "utf-8"));
    void vscode.window.showInformationMessage(`Exported to ${target.fsPath}`);
  }
}
