import * as vscode from "vscode";
import { getDesignTokensCss } from "../ui/styles";
import type { ConnectionStore } from "../connections/store";
import type { ConnectionManager } from "../connections/manager";
import type { SchemaCache } from "../connections/schema-cache";
import { parseCsv } from "./csv-parser";
import { inferTypes } from "./infer";
import { importCsvIntoTable } from "./runner";
import {
  isWebviewMessage,
  type HostMessage,
  type WebviewMessage,
} from "./protocol";

export class CsvImportPanel {
  private static current: CsvImportPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private cachedRows: string[][] | undefined;
  private cachedFilePath: string | undefined;

  static show(
    context: vscode.ExtensionContext,
    store: ConnectionStore,
    manager: ConnectionManager,
    schemaCache: SchemaCache,
    profileId: string,
    onImported: () => void,
  ): CsvImportPanel {
    if (CsvImportPanel.current) {
      // Update connection in case the user switched profiles since last open.
      CsvImportPanel.current.profileId = profileId;
      CsvImportPanel.current.panel.title = `Import CSV — ${store.get(profileId)?.name ?? ""}`;
      CsvImportPanel.current.panel.reveal();
      void CsvImportPanel.current.postReady();
      return CsvImportPanel.current;
    }
    CsvImportPanel.current = new CsvImportPanel(
      context,
      store,
      manager,
      schemaCache,
      profileId,
      onImported,
    );
    return CsvImportPanel.current;
  }

  private constructor(
    context: vscode.ExtensionContext,
    private readonly store: ConnectionStore,
    private readonly manager: ConnectionManager,
    private readonly schemaCache: SchemaCache,
    private profileId: string,
    private readonly onImported: () => void,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "vsSqlEditor.import",
      `Import CSV — ${store.get(profileId)?.name ?? ""}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
      },
    );
    this.panel.webview.html = this.html(context.extensionUri);
    this.panel.webview.onDidReceiveMessage((m) => {
      if (isWebviewMessage(m)) void this.handle(m);
    });
    this.panel.onDidDispose(() => {
      CsvImportPanel.current = undefined;
    });
  }

  private post(m: HostMessage): void {
    void this.panel.webview.postMessage(m);
  }

  private async postReady(): Promise<void> {
    const profile = this.store.get(this.profileId);
    if (!profile) {
      this.post({ type: "error", message: "Connection not found." });
      return;
    }
    let schemas: string[] = [];
    if (
      profile.engine === "postgres" ||
      profile.engine === "pglite" ||
      profile.engine === "mysql" ||
      profile.engine === "clickhouse"
    ) {
      try {
        const model = await this.schemaCache.get(this.profileId);
        const set = new Set<string>();
        for (const db of model.databases) for (const s of db.schemas) set.add(s.name);
        schemas = [...set];
      } catch {
        schemas = [];
      }
    }
    this.post({
      type: "ready",
      connectionName: profile.name,
      engine: profile.engine,
      schemas,
    });
  }

  private async handle(m: WebviewMessage): Promise<void> {
    if (m.type === "ready") {
      await this.postReady();
      return;
    }
    if (m.type === "pickFile") {
      const uri = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectMany: false,
        filters: { CSV: ["csv", "tsv", "txt"] },
      });
      if (!uri || !uri[0]) return;
      await this.loadFile(uri[0].fsPath);
      return;
    }
    if (m.type === "runImport") {
      await this.runImport(m);
      return;
    }
    if (m.type === "cancel") {
      this.panel.dispose();
      return;
    }
  }

  private async loadFile(filePath: string): Promise<void> {
    try {
      const buf = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      const text = Buffer.from(buf).toString("utf-8");
      const rows = parseCsv(text);
      if (rows.length < 1) {
        this.post({ type: "error", message: "CSV is empty." });
        return;
      }
      const headerRow = rows[0].map((h, i) => h.trim() || `col${i + 1}`);
      const bodyRows = rows.slice(1);
      const inferred = inferTypes(bodyRows).map((t, i) => ({
        name: headerRow[i],
        type: t,
      }));
      this.cachedRows = bodyRows;
      this.cachedFilePath = filePath;
      this.post({
        type: "preview",
        filename: filePath.split(/[\\/]/).pop() ?? filePath,
        filePath,
        headerRow,
        sampleRows: bodyRows.slice(0, 20),
        totalRows: bodyRows.length,
        inferred,
        defaultTableName: defaultName(filePath),
      });
    } catch (err) {
      this.post({ type: "error", message: (err as Error).message });
    }
  }

  private async runImport(
    m: Extract<WebviewMessage, { type: "runImport" }>,
  ): Promise<void> {
    if (!this.cachedRows || this.cachedFilePath !== m.filePath) {
      // Re-read the file in case it changed since preview.
      try {
        const buf = await vscode.workspace.fs.readFile(vscode.Uri.file(m.filePath));
        const text = Buffer.from(buf).toString("utf-8");
        const rows = parseCsv(text);
        this.cachedRows = rows.slice(1);
        this.cachedFilePath = m.filePath;
      } catch (err) {
        this.post({ type: "error", message: (err as Error).message });
        return;
      }
    }
    const profile = this.store.get(this.profileId);
    if (!profile) {
      this.post({ type: "error", message: "Connection not found." });
      return;
    }
    try {
      const result = await importCsvIntoTable({
        manager: this.manager,
        profileId: this.profileId,
        engine: profile.engine,
        targetSchema: m.targetSchema,
        targetTable: m.targetTable,
        columns: m.columns,
        rows: this.cachedRows,
        onProgress: (done, total) => this.post({ type: "progress", done, total }),
      });
      this.post({
        type: "done",
        rowsInserted: result.rowsInserted,
        targetTable: m.targetTable,
        targetSchema: m.targetSchema,
      });
      // Invalidate schema cache so the new table shows up in the sidebar.
      this.schemaCache.invalidate();
      this.onImported();
    } catch (err) {
      this.post({ type: "error", message: (err as Error).message });
    }
  }

  private html(extensionUri: vscode.Uri): string {
    const nonce = Buffer.from(`${Date.now()}-${Math.random()}`).toString("base64").slice(0, 16);
    const src = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "dist", "import.js"),
    );
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    return `<!DOCTYPE html><html><head>
      <meta http-equiv="Content-Security-Policy" content="${csp}">
      <style>
${getDesignTokensCss()}

body {
  padding: var(--vsx-gap-xl);
  display: flex;
  justify-content: center;
}
.shell { width: 100%; max-width: 880px; }

h1 {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 var(--vsx-gap-xs) 0;
}
.subtitle {
  color: var(--vscode-descriptionForeground);
  font-size: 12.5px;
  margin-bottom: var(--vsx-gap-lg);
}

.drop {
  border: 2px dashed var(--vsx-border-strong);
  border-radius: var(--vsx-radius-lg);
  padding: var(--vsx-gap-xl);
  text-align: center;
  cursor: pointer;
}
.drop.over { background: var(--vsx-surface-hover); border-color: var(--vscode-focusBorder); }
.drop .icon { font-size: 30px; opacity: 0.5; margin-bottom: var(--vsx-gap-sm); }
.drop .hint { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: var(--vsx-gap-xs); }

.preview-meta {
  display: flex;
  align-items: center;
  gap: var(--vsx-gap-sm);
  margin-bottom: var(--vsx-gap-md);
}
.preview-meta .filename { font-weight: 500; }
.preview-meta .rowcount { color: var(--vscode-descriptionForeground); font-size: 12px; }
.preview-meta .change { margin-left: auto; }

.target-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--vsx-gap-md);
  margin-bottom: var(--vsx-gap-md);
}
.field { display: flex; flex-direction: column; gap: 4px; }
.field label { font-size: 11px; color: var(--vscode-descriptionForeground); }

.cols {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--vsx-gap-sm) var(--vsx-gap-md);
  margin-bottom: var(--vsx-gap-md);
  padding: var(--vsx-gap-md);
  background: var(--vsx-surface);
  border: 1px solid var(--vsx-border);
  border-radius: var(--vsx-radius);
}
.cols .heading {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--vscode-descriptionForeground);
  font-weight: 600;
}
.cols input[type="text"] { height: 24px; font-size: 12px; }
.cols select { height: 24px; font-size: 12px; }

#preview-grid {
  margin-top: var(--vsx-gap-md);
  border: 1px solid var(--vsx-border);
  border-radius: var(--vsx-radius);
  overflow: auto;
  max-height: 240px;
}
#preview-grid table { border-collapse: collapse; font-size: 11.5px; width: 100%; }
#preview-grid th, #preview-grid td {
  border-right: 1px solid var(--vsx-border);
  border-bottom: 1px solid var(--vsx-border);
  padding: 3px 8px;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}
#preview-grid th {
  background: var(--vsx-surface);
  font-weight: 600;
  position: sticky;
  top: 0;
}

.actions {
  display: flex;
  gap: var(--vsx-gap-sm);
  margin-top: var(--vsx-gap-lg);
  padding-top: var(--vsx-gap-md);
  border-top: 1px solid var(--vsx-border);
}
.actions .spacer { flex: 1; }

#status {
  margin-top: var(--vsx-gap-md);
  font-size: 12px;
}
#status.err { color: var(--vsx-danger); white-space: pre-wrap; }
#status.ok { color: var(--vsx-success); }

#progress-wrap {
  margin-top: var(--vsx-gap-md);
  height: 4px;
  background: var(--vsx-surface);
  border-radius: 999px;
  overflow: hidden;
  display: none;
}
#progress-wrap.show { display: block; }
#progress-bar { height: 100%; background: var(--vsx-success); width: 0%; transition: width 100ms; }

[hidden] { display: none !important; }
      </style></head>
      <body>
        <div class="shell">
          <h1 id="title">Import CSV</h1>
          <div class="subtitle" id="subtitle">Drop a CSV file to preview, choose a target table, and import.</div>

          <div class="drop" id="drop">
            <div class="icon">⬇</div>
            <div>Drop a CSV here or <u>click to browse</u></div>
            <div class="hint">UTF-8 · comma- or tab-delimited · first row is header</div>
          </div>

          <div id="preview" hidden>
            <div class="preview-meta">
              <span class="filename" id="filename"></span>
              <span class="rowcount" id="rowcount"></span>
              <button class="change ghost" id="change-file">Change file…</button>
            </div>

            <div class="target-row">
              <div class="field" id="schema-field">
                <label for="schema-select">Target schema</label>
                <select id="schema-select"></select>
              </div>
              <div class="field">
                <label for="table-name">Target table</label>
                <input id="table-name" type="text" />
              </div>
            </div>

            <div class="cols">
              <div class="heading">Column</div>
              <div class="heading">Type</div>
              <div id="col-rows" style="display:contents"></div>
            </div>

            <div id="preview-grid"></div>

            <div class="actions">
              <div class="spacer"></div>
              <button class="ghost" id="cancel">Cancel</button>
              <button class="primary" id="import">Import</button>
            </div>

            <div id="progress-wrap"><div id="progress-bar"></div></div>
            <div id="status"></div>
          </div>
        </div>
        <script nonce="${nonce}" src="${src}"></script>
      </body></html>`;
  }
}

function defaultName(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? "imported";
  const stem = base.replace(/\.[^.]+$/, "");
  return stem.replace(/[^a-zA-Z0-9_]+/g, "_").toLowerCase() || "imported";
}
