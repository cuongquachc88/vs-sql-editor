import * as vscode from "vscode";
import { getDesignTokensCss } from "../ui/styles";
import type { ConnectionStore } from "../connections/store";
import type { ConnectionManager } from "../connections/manager";
import type { SchemaCache } from "../connections/schema-cache";
import type { EngineId } from "../drivers/types";
import { DriverError } from "../drivers/types";
import { generateAlterTable, generateCreateTable } from "./ddl";
import {
  TYPE_CATALOG,
  defaultSchema,
  emptyTable,
  type DesignerMode,
  type TableSchema,
} from "./model";
import {
  isWebviewMessage,
  type HostMessage,
  type WebviewMessage,
} from "./protocol";

interface OpenArgs {
  mode: DesignerMode;
  profileId: string;
  // For edit mode, the existing table to load.
  schema?: string;
  table?: string;
  // Optional: pre-seeded schema (for create mode).
  preferredSchema?: string;
}

export interface TableDesignerDeps {
  store: ConnectionStore;
  manager: ConnectionManager;
  schemaCache: SchemaCache;
  onSaved: () => void;
}

export class TableDesignerPanel {
  private static current: TableDesignerPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private args!: OpenArgs;
  private original!: TableSchema;
  private engine!: EngineId;

  static show(
    context: vscode.ExtensionContext,
    deps: TableDesignerDeps,
    args: OpenArgs,
  ): TableDesignerPanel {
    if (TableDesignerPanel.current) {
      TableDesignerPanel.current.args = args;
      TableDesignerPanel.current.panel.reveal();
      void TableDesignerPanel.current.postInit();
      return TableDesignerPanel.current;
    }
    TableDesignerPanel.current = new TableDesignerPanel(context, deps, args);
    return TableDesignerPanel.current;
  }

  private constructor(
    context: vscode.ExtensionContext,
    private readonly deps: TableDesignerDeps,
    args: OpenArgs,
  ) {
    this.args = args;
    const profile = deps.store.get(args.profileId);
    this.panel = vscode.window.createWebviewPanel(
      "vsSqlEditor.tableDesigner",
      args.mode === "create"
        ? `Create Table — ${profile?.name ?? "Connection"}`
        : `Edit Table ${args.schema}.${args.table}`,
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
      TableDesignerPanel.current = undefined;
    });
  }

  private async postInit(): Promise<void> {
    const profile = this.deps.store.get(this.args.profileId);
    if (!profile) return;
    this.engine = profile.engine;
    const schemas = await this.collectSchemas();
    const sch = this.args.schema ?? this.args.preferredSchema ?? defaultSchema(profile.engine);
    if (this.args.mode === "edit" && this.args.table) {
      this.original = await this.loadExistingTable(sch, this.args.table);
    } else {
      this.original = emptyTable(profile.engine, sch);
    }
    this.post({
      type: "init",
      mode: this.args.mode,
      engine: profile.engine,
      connectionName: profile.name,
      schemas,
      original: this.original,
      typeCatalog: TYPE_CATALOG[profile.engine],
    });
  }

  private async collectSchemas(): Promise<string[]> {
    try {
      const model = await this.deps.schemaCache.get(this.args.profileId);
      const set = new Set<string>();
      for (const db of model.databases) for (const s of db.schemas) set.add(s.name);
      return [...set];
    } catch {
      return [];
    }
  }

  private async loadExistingTable(schema: string, table: string): Promise<TableSchema> {
    const model = await this.deps.schemaCache.get(this.args.profileId);
    const tbl = model.databases
      .flatMap((d) => d.schemas)
      .find((s) => s.name === schema)
      ?.tables.find((t) => t.name === table);
    if (!tbl) {
      return emptyTable(this.engine, schema);
    }
    return {
      schema,
      name: tbl.name,
      columns: tbl.columns.map((c) => ({
        name: c.name,
        type: c.type,
        nullable: !tbl.primaryKey.includes(c.name),
        isPrimary: tbl.primaryKey.includes(c.name),
      })),
      foreignKeys: tbl.foreignKeys.map((fk) => ({
        columns: fk.columns,
        refSchema: fk.refSchema,
        refTable: fk.refTable,
        refColumns: fk.refColumns,
      })),
      indexes: [],
      checks: [],
    };
  }

  private post(m: HostMessage): void {
    void this.panel.webview.postMessage(m);
  }

  private async handle(m: WebviewMessage): Promise<void> {
    if (m.type === "ready") {
      await this.postInit();
      return;
    }
    if (m.type === "cancel") {
      this.panel.dispose();
      return;
    }
    if (m.type === "requestPreview") {
      const sql = this.generate(m.current);
      this.post({ type: "previewSql", sql });
      return;
    }
    if (m.type === "save") {
      const sql = this.generate(m.current);
      try {
        const session = await this.deps.manager.get(this.args.profileId);
        const driver = this.deps.manager.driverOf(this.args.profileId);
        if (!driver) throw new Error("Driver not loaded");
        // Run each statement sequentially. If any fails, surface the error.
        for (const stmt of splitStatements(sql)) {
          if (!stmt) continue;
          await driver.query(session, stmt);
        }
        this.post({ type: "saveResult", ok: true });
        this.deps.onSaved();
        // Close panel on success.
        this.panel.dispose();
      } catch (err) {
        const e = DriverError.from(err);
        this.post({ type: "saveResult", ok: false, error: e.message });
      }
      return;
    }
  }

  private generate(current: TableSchema): string {
    const stmts =
      this.args.mode === "create"
        ? generateCreateTable(this.engine, current)
        : generateAlterTable(this.engine, this.original, current);
    if (stmts.length === 0) {
      return this.args.mode === "create"
        ? "-- Add at least one column to preview the CREATE TABLE statement."
        : "-- No changes detected.";
    }
    return stmts.join(";\n\n") + ";";
  }

  private html(extensionUri: vscode.Uri): string {
    const nonce = Buffer.from(`${Date.now()}-${Math.random()}`).toString("base64").slice(0, 16);
    const src = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "dist", "table-designer.js"),
    );
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    return `<!DOCTYPE html><html><head>
      <meta http-equiv="Content-Security-Policy" content="${csp}">
      <style>
${getDesignTokensCss()}

body {
  padding: 0;
  display: flex;
  flex-direction: column;
  height: 100vh;
}
.shell {
  max-width: 1100px;
  width: 100%;
  margin: 0 auto;
  padding: var(--vsx-gap-lg) var(--vsx-gap-xl);
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

.title-row { display: flex; align-items: center; gap: var(--vsx-gap-md); margin-bottom: var(--vsx-gap-md); }
h1 { font-size: 18px; font-weight: 600; margin: 0; }
.subtitle { color: var(--vscode-descriptionForeground); font-size: 12.5px; margin-bottom: var(--vsx-gap-lg); }

.header-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--vsx-gap);
  margin-bottom: var(--vsx-gap-lg);
}
.field { display: flex; flex-direction: column; gap: 4px; }
.field label { font-size: 11px; color: var(--vscode-descriptionForeground); }

.tab-bar {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--vsx-border);
  margin-bottom: var(--vsx-gap-md);
  padding: 0 2px;
}
.tab-bar button {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  padding: 8px 16px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  transition: color var(--vsx-transition), border-color var(--vsx-transition),
              background-color var(--vsx-transition);
  border-radius: var(--vsx-radius-sm) var(--vsx-radius-sm) 0 0;
}
.tab-bar button:hover {
  color: var(--vscode-foreground);
  background: var(--vsx-surface-hover);
}
.tab-bar button.active {
  color: var(--vsx-accent);
  border-bottom-color: var(--vsx-accent);
  font-weight: 600;
}

.section { display: none; flex: 1; min-height: 0; overflow: auto; }
.section.active { display: block; }

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: var(--vsx-gap) 0 var(--vsx-gap-sm) 0;
}
.section-head h2 {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--vscode-descriptionForeground);
  margin: 0;
}

.grid-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  background: var(--vsx-surface);
  border: 1px solid var(--vsx-border);
  border-radius: var(--vsx-radius-lg);
  overflow: hidden;
  font-size: 12px;
  box-shadow: var(--vsx-shadow-sm);
}
.grid-table th, .grid-table td {
  text-align: left;
  padding: 5px 8px;
  border-bottom: 1px solid var(--vsx-border);
  vertical-align: middle;
}
.grid-table th {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--vscode-descriptionForeground);
  font-weight: 700;
  background: var(--vsx-surface-2);
}
.grid-table tr:last-child td { border-bottom: none; }
.grid-table tbody tr:hover td { background: var(--vsx-surface-hover); }
.grid-table input[type="text"], .grid-table input[type="number"] {
  height: 24px;
  font-size: 12px;
  padding: 0 6px;
  width: 100%;
}
.grid-table input[type="checkbox"] { margin: 0; accent-color: var(--vsx-accent); }
.grid-table button {
  height: 22px;
  padding: 0 8px;
  font-size: 11px;
}
.btn-row {
  display: flex;
  gap: var(--vsx-gap-xs);
  margin-top: var(--vsx-gap-sm);
}

#preview {
  background: var(--vsx-surface-2);
  border: 1px solid var(--vsx-border);
  border-radius: var(--vsx-radius-lg);
  padding: var(--vsx-gap-md);
  font-family: var(--vscode-editor-font-family);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  max-height: 320px;
  overflow: auto;
  margin: var(--vsx-gap) 0;
  color: var(--vscode-foreground);
  box-shadow: inset 0 1px 3px rgba(0,0,0,0.06);
}
#status {
  margin-top: var(--vsx-gap-sm);
  padding: var(--vsx-gap-sm) var(--vsx-gap);
  border-radius: var(--vsx-radius);
  font-size: 12px;
  display: none;
}
#status.err {
  display: block;
  background: color-mix(in srgb, var(--vsx-danger), transparent 92%);
  color: var(--vsx-danger);
  border: 1px solid color-mix(in srgb, var(--vsx-danger), transparent 70%);
  border-left: 3px solid var(--vsx-danger);
}
#status.ok {
  display: block;
  background: color-mix(in srgb, var(--vsx-success), transparent 90%);
  color: var(--vsx-success);
  border: 1px solid color-mix(in srgb, var(--vsx-success), transparent 70%);
  border-left: 3px solid var(--vsx-success);
}

.actions {
  display: flex;
  align-items: center;
  gap: var(--vsx-gap-sm);
  margin-top: var(--vsx-gap-md);
  padding-top: var(--vsx-gap-md);
  border-top: 1px solid var(--vsx-border);
}
.actions .spacer { flex: 1; }

.kv-list { display: flex; flex-direction: column; gap: var(--vsx-gap-sm); }
.kv-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--vsx-gap-xs);
  align-items: start;
}
.kv-row textarea {
  width: 100%;
  min-height: 60px;
  font-family: var(--vscode-editor-font-family);
  font-size: 12px;
  padding: var(--vsx-gap-xs);
}
.kv-card {
  border: 1px solid var(--vsx-border);
  border-radius: var(--vsx-radius);
  background: var(--vsx-surface);
  padding: var(--vsx-gap-sm);
}
.kv-card .kv-card-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--vsx-gap-xs);
}
.kv-card .kv-card-grid input, .kv-card .kv-card-grid select {
  height: 26px;
  font-size: 11.5px;
}
.kv-card .row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--vsx-gap-xs);
}
      </style></head>
      <body>
        <div class="shell">
          <div class="title-row">
            <h1 id="title">Table Designer</h1>
          </div>
          <div class="subtitle" id="subtitle">Loading…</div>

          <div class="header-grid">
            <div class="field">
              <label for="t-schema">Schema</label>
              <select id="t-schema"></select>
            </div>
            <div class="field">
              <label for="t-name">Table name</label>
              <input id="t-name" type="text" placeholder="my_table" />
            </div>
          </div>

          <div class="tab-bar">
            <button class="tab-btn active" data-tab="columns">Columns</button>
            <button class="tab-btn" data-tab="constraints">Constraints</button>
            <button class="tab-btn" data-tab="preview">Preview SQL</button>
          </div>

          <div class="section active" data-section="columns">
            <table class="grid-table">
              <thead>
                <tr>
                  <th style="width:22%">Name</th>
                  <th style="width:24%">Type</th>
                  <th style="width:9%">Nullable</th>
                  <th style="width:9%">PK</th>
                  <th>Default</th>
                  <th>Comment</th>
                  <th style="width:44px"></th>
                </tr>
              </thead>
              <tbody id="cols-body"></tbody>
            </table>
            <div class="btn-row"><button class="ghost" id="cols-add">+ Add column</button></div>
          </div>

          <div class="section" data-section="constraints">
            <div class="section-head"><h2>Foreign Keys</h2>
              <button class="ghost" id="fk-add">+ Add FK</button>
            </div>
            <div class="kv-list" id="fks"></div>

            <div class="section-head"><h2>Indexes</h2>
              <button class="ghost" id="idx-add">+ Add Index</button>
            </div>
            <div class="kv-list" id="idxs"></div>

            <div class="section-head"><h2>Check Constraints</h2>
              <button class="ghost" id="chk-add">+ Add Check</button>
            </div>
            <div class="kv-list" id="checks"></div>
          </div>

          <div class="section" data-section="preview">
            <pre id="preview"></pre>
          </div>

          <div id="status"></div>
          <div class="actions">
            <button class="ghost" id="refresh-preview">Refresh Preview</button>
            <div class="spacer"></div>
            <button class="ghost" id="cancel-btn">Cancel</button>
            <button class="primary" id="save-btn">Save</button>
          </div>
        </div>
        <script nonce="${nonce}" src="${src}"></script>
      </body></html>`;
  }
}

// Split a multi-statement SQL on `;` at top level (no quotes/comments handling
// — the DDL we generate is well-formed so simple split is fine).
function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*\n+/)
    .map((s) => s.trim().replace(/;$/, ""))
    .filter((s) => s.length > 0);
}
