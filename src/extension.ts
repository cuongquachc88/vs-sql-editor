import * as vscode from "vscode";
import { registerBuiltInDrivers } from "./drivers/index";
import { createDriver } from "./drivers/registry";
import { ConnectionStore } from "./connections/store";
import { ConnectionManager } from "./connections/manager";
import { ResultsPanel } from "./results/panel";
import { resolveSql, runAndShow } from "./editor/runner";
import type { EngineId } from "./drivers/types";

let activeProfileId: string | undefined;

export function activate(context: vscode.ExtensionContext): void {
  registerBuiltInDrivers();

  const store = new ConnectionStore(context.globalState, context.secrets);
  const manager = new ConnectionManager(
    (engine) => createDriver(engine),
    (id) => store.getSecret(id),
    (id) => store.get(id),
  );

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = "vsSqlEditor.selectConnection";
  const refreshStatus = () => {
    const p = activeProfileId ? store.get(activeProfileId) : undefined;
    status.text = p ? `$(database) ${p.name}` : "$(database) No SQL connection";
    status.show();
  };
  refreshStatus();

  context.subscriptions.push(
    status,
    vscode.commands.registerCommand("vsSqlEditor.addConnection", () => addConnection(store)),
    vscode.commands.registerCommand("vsSqlEditor.selectConnection", async () => {
      activeProfileId = await pickConnection(store);
      refreshStatus();
    }),
    vscode.commands.registerCommand("vsSqlEditor.runQuery", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showErrorMessage("Open a .sql file first.");
        return;
      }
      if (!activeProfileId) {
        activeProfileId = await pickConnection(store);
        refreshStatus();
        if (!activeProfileId) return;
      }
      const sql = resolveSql(editor.document.getText(), editor.document.getText(editor.selection));
      if (!sql) {
        void vscode.window.showErrorMessage("Nothing to run.");
        return;
      }
      const panel = ResultsPanel.show(context);
      const pageSize = vscode.workspace
        .getConfiguration("vsSqlEditor")
        .get<number>("pageSize", 500);
      await runAndShow({ manager, profileId: activeProfileId, pageSize, panel }, sql);
    }),
    vscode.languages.registerCodeLensProvider(
      { language: "sql" },
      {
        provideCodeLenses(document) {
          void document;
          const top = new vscode.Range(0, 0, 0, 0);
          return [
            new vscode.CodeLens(top, { title: "▶ Run Query", command: "vsSqlEditor.runQuery" }),
          ];
        },
      },
    ),
  );

  context.subscriptions.push({ dispose: () => void manager.disposeAll() });
}

export function deactivate(): void {}

async function pickConnection(store: ConnectionStore): Promise<string | undefined> {
  const items = store.list().map((p) => ({ label: p.name, description: p.engine, id: p.id }));
  if (items.length === 0) {
    const add = await vscode.window.showInformationMessage(
      "No connections yet.",
      "Add Connection",
    );
    if (add) {
      const p = await addConnection(store);
      return p?.id;
    }
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(items, { placeHolder: "Select a connection" });
  return pick?.id;
}

async function addConnection(store: ConnectionStore) {
  const name = await vscode.window.showInputBox({ prompt: "Connection name" });
  if (!name) return undefined;
  const engine = (await vscode.window.showQuickPick(["postgres"], {
    placeHolder: "Engine (Phase 1: postgres)",
  })) as EngineId | undefined;
  if (!engine) return undefined;
  const host = await vscode.window.showInputBox({ prompt: "Host", value: "localhost" });
  const port = Number(await vscode.window.showInputBox({ prompt: "Port", value: "5432" }));
  const database = await vscode.window.showInputBox({ prompt: "Database" });
  const user = await vscode.window.showInputBox({ prompt: "User" });
  const password = await vscode.window.showInputBox({ prompt: "Password", password: true });
  return store.add({ name, engine, host, port, database, user }, password || undefined);
}
