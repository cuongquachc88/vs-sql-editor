import * as vscode from "vscode";
import { getDesignTokensCss } from "../../ui/styles";
import type { ConnectionStore } from "../store";
import type { SchemaCache } from "../schema-cache";
import {
  isWebviewMessage,
  type ConnectionSummary,
  type HostMessage,
  type WebviewMessage,
} from "./protocol";

export interface SidebarCallbacks {
  onAddConnection: () => void;
  onNewQuery: (profileId: string | undefined) => Promise<void> | void;
  onSetActive: (profileId: string) => Promise<void> | void;
  onEdit: (profileId: string) => void;
  onDuplicate: (profileId: string) => void;
  onDelete: (profileId: string) => Promise<void> | void;
  onPreviewTable: (
    profileId: string,
    database: string,
    schema: string,
    table: string,
    isView: boolean,
  ) => Promise<void> | void;
  onCreateDatabase: (profileId: string) => Promise<void> | void;
  onCreateSchema: (profileId: string, database: string) => Promise<void> | void;
  onCreateTable: (
    profileId: string,
    database: string,
    schema: string,
  ) => Promise<void> | void;
  onEditTable: (
    profileId: string,
    database: string,
    schema: string,
    table: string,
  ) => Promise<void> | void;
  onDropTable: (
    profileId: string,
    database: string,
    schema: string,
    table: string,
    isView: boolean,
  ) => Promise<void> | void;
  getActiveProfileId: () => string | undefined;
  getLiveProfileIds: () => string[];
}

export class ConnectionsViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "vsSqlEditorConnections";
  private static readonly EXPANDED_KEY = "vsSqlEditor.sidebar.expanded";
  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: ConnectionStore,
    private readonly schemaCache: SchemaCache,
    private readonly callbacks: SidebarCallbacks,
  ) {}

  private getExpanded(): { openConnections: string[]; openNodes: string[] } {
    return this.context.globalState.get(ConnectionsViewProvider.EXPANDED_KEY, {
      openConnections: [],
      openNodes: [],
    });
  }
  private async setExpanded(openConnections: string[], openNodes: string[]): Promise<void> {
    await this.context.globalState.update(ConnectionsViewProvider.EXPANDED_KEY, {
      openConnections,
      openNodes,
    });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist")],
    };
    view.webview.html = this.html();
    view.webview.onDidReceiveMessage((m) => {
      if (isWebviewMessage(m)) void this.handle(m);
    });
    view.onDidDispose(() => {
      this.view = undefined;
    });
  }

  // Push a fresh connection list + active id to the webview.
  postState(): void {
    if (!this.view) return;
    const connections = this.summaries();
    const ex = this.getExpanded();
    this.post({
      type: "state",
      connections,
      activeId: this.callbacks.getActiveProfileId(),
      liveIds: this.callbacks.getLiveProfileIds(),
      openConnections: ex.openConnections,
      openNodes: ex.openNodes,
    });
  }

  // Lighter update for active-id changes (no list rebuild needed).
  postActiveChanged(): void {
    this.post({ type: "activeChanged", activeId: this.callbacks.getActiveProfileId() });
  }

  // Tell the webview which connections currently have a live driver session.
  postLiveChanged(): void {
    this.post({ type: "liveChanged", liveIds: this.callbacks.getLiveProfileIds() });
  }

  // Invalidate the schema cache + ask the webview to re-fetch any open schemas.
  refresh(): void {
    this.schemaCache.invalidate();
    this.postState();
  }

  private summaries(): ConnectionSummary[] {
    return this.store.list().map((p) => ({
      id: p.id,
      name: p.name,
      engine: p.engine,
      host: p.host,
      filePath: p.filePath,
      database: p.database,
    }));
  }

  private post(m: HostMessage): void {
    if (!this.view) return;
    void this.view.webview.postMessage(m);
  }

  private async handle(m: WebviewMessage): Promise<void> {
    if (m.type === "ready") {
      this.postState();
      return;
    }
    if (m.type === "refresh") {
      this.refresh();
      return;
    }
    if (m.type === "addConnection") {
      this.callbacks.onAddConnection();
      return;
    }
    if (m.type === "newQuery") {
      await this.callbacks.onNewQuery(m.profileId);
      return;
    }
    if (m.type === "setActive") {
      await this.callbacks.onSetActive(m.profileId);
      return;
    }
    if (m.type === "edit") {
      this.callbacks.onEdit(m.profileId);
      return;
    }
    if (m.type === "duplicate") {
      this.callbacks.onDuplicate(m.profileId);
      return;
    }
    if (m.type === "delete") {
      await this.callbacks.onDelete(m.profileId);
      return;
    }
    if (m.type === "expandedChanged") {
      await this.setExpanded(m.openConnections, m.openNodes);
      // Eagerly preload schemas for connections that should be expanded so
      // their tree shows up immediately on the next reload.
      for (const id of m.openConnections) {
        void this.schemaCache.get(id).catch(() => undefined);
      }
      return;
    }
    if (m.type === "loadSchema") {
      try {
        const model = await this.schemaCache.get(m.profileId);
        this.post({ type: "schema", profileId: m.profileId, model });
      } catch (err) {
        this.post({
          type: "schema",
          profileId: m.profileId,
          model: null,
          error: (err as Error).message,
        });
      }
      return;
    }
    if (m.type === "previewTable") {
      await this.callbacks.onPreviewTable(
        m.profileId,
        m.database,
        m.schema,
        m.table,
        m.isView,
      );
      return;
    }
    if (m.type === "createDatabase") {
      await this.callbacks.onCreateDatabase(m.profileId);
      return;
    }
    if (m.type === "createSchema") {
      await this.callbacks.onCreateSchema(m.profileId, m.database);
      return;
    }
    if (m.type === "createTable") {
      await this.callbacks.onCreateTable(m.profileId, m.database, m.schema);
      return;
    }
    if (m.type === "editTable") {
      await this.callbacks.onEditTable(m.profileId, m.database, m.schema, m.table);
      return;
    }
    if (m.type === "dropTable") {
      await this.callbacks.onDropTable(
        m.profileId,
        m.database,
        m.schema,
        m.table,
        m.isView,
      );
      return;
    }
  }

  private html(): string {
    if (!this.view) return "";
    const nonce = Buffer.from(`${Date.now()}-${Math.random()}`).toString("base64").slice(0, 16);
    const src = this.view.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "connections-sidebar.js"),
    );
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    return `<!DOCTYPE html><html><head>
      <meta http-equiv="Content-Security-Policy" content="${csp}">
      <style>
${getDesignTokensCss()}

html, body { height: 100%; }
body {
  display: flex;
  flex-direction: column;
  padding: 0;
}

#header {
  display: flex;
  align-items: center;
  gap: var(--vsx-gap-xs);
  padding: var(--vsx-gap-sm) var(--vsx-gap);
  border-bottom: 1px solid var(--vsx-border);
  background: var(--vsx-surface);
  flex-shrink: 0;
}
#search {
  flex: 1;
  height: 24px;
  font-size: 12px;
}
#header button { height: 24px; padding: 0 8px; font-size: 11px; }

#list {
  flex: 1;
  overflow: auto;
  padding: var(--vsx-gap-xs) 0;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  height: 100%;
  padding: var(--vsx-gap-xl) var(--vsx-gap-md);
  color: var(--vscode-descriptionForeground);
  gap: var(--vsx-gap);
}
.empty-icon { font-size: 32px; opacity: 0.5; }

/* Connection row */
.conn {
  display: flex;
  flex-direction: column;
}
.conn-row {
  display: grid;
  grid-template-columns: 12px 28px 1fr auto;
  align-items: center;
  gap: var(--vsx-gap-sm);
  padding: var(--vsx-gap-xs) var(--vsx-gap-sm);
  cursor: pointer;
  position: relative;
  border-left: 2px solid transparent;
}
.conn-row:hover { background: var(--vsx-surface-hover); }
.conn.active > .conn-row {
  border-left-color: var(--engine-accent, var(--vsx-accent));
  background: color-mix(in srgb, var(--engine-accent, var(--vsx-accent)), transparent 92%);
}
.conn-row .caret {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  transition: transform 100ms;
  text-align: center;
  user-select: none;
}
.conn.open > .conn-row .caret { transform: rotate(90deg); }
.conn-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.25;
}
.conn-name {
  font-weight: 500;
  font-size: 12.5px;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.conn-name .dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--vsx-success);
  flex-shrink: 0;
}
.conn-meta {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.conn-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
}
.conn-row:hover .conn-actions { opacity: 1; }
.conn-actions button {
  height: 22px;
  width: 22px;
  padding: 0;
  font-size: 12px;
  background: transparent;
}
.conn-actions button:hover { background: var(--vsx-surface-active); }
.conn-actions button.danger:hover {
  color: var(--vsx-danger);
}

.schema-tree {
  display: none;
  padding: 2px 0 var(--vsx-gap-xs) 0;
  font-size: 12px;
}
.conn.open > .schema-tree { display: block; }
.schema-tree .branch {
  padding: 2px var(--vsx-gap-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--vscode-foreground);
  user-select: none;
}
.schema-tree .branch:hover { background: var(--vsx-surface-hover); }
.schema-tree .branch .caret {
  font-size: 9px;
  color: var(--vscode-descriptionForeground);
  width: 10px;
  text-align: center;
  transition: transform 100ms;
}
.schema-tree .branch.open .caret { transform: rotate(90deg); }
.schema-tree .lvl-db    { padding-left: 36px; }
.schema-tree .lvl-sch   { padding-left: 50px; }
.schema-tree .lvl-table { padding-left: 64px; }
.schema-tree .lvl-col   { padding-left: 80px; color: var(--vscode-descriptionForeground); }
.schema-tree .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.schema-tree .badge {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  margin-left: var(--vsx-gap-xs);
}
.schema-tree .icon {
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--vscode-descriptionForeground);
}
.schema-tree .icon svg { display: block; }
.schema-tree .lvl-fn    { padding-left: 64px; color: var(--vscode-descriptionForeground); }
.schema-tree .row.match .label { color: var(--vscode-editor-findMatchHighlightForeground); }
.schema-tree .row.hidden { display: none; }
.schema-tree .loading {
  padding: var(--vsx-gap-xs) var(--vsx-gap-md);
  color: var(--vscode-descriptionForeground);
  font-style: italic;
}
.schema-tree .err {
  padding: var(--vsx-gap-xs) var(--vsx-gap-md);
  color: var(--vsx-danger);
  font-family: var(--vscode-editor-font-family);
}

#footer {
  border-top: 1px solid var(--vsx-border);
  padding: var(--vsx-gap-sm) var(--vsx-gap);
  display: flex;
  align-items: center;
  gap: var(--vsx-gap-sm);
}
#footer button { height: 24px; padding: 0 10px; font-size: 11px; flex: 1; }

/* Right-click context menu */
#ctx-menu {
  position: fixed;
  z-index: 100;
  background: color-mix(in srgb, var(--vscode-editor-background), var(--vscode-foreground) 4%);
  border: 1px solid var(--vsx-border-strong);
  border-radius: var(--vsx-radius-lg);
  padding: 4px 0;
  font-size: 12px;
  box-shadow: var(--vsx-shadow-lg);
  backdrop-filter: blur(12px);
  display: none;
  min-width: 200px;
}
#ctx-menu.show { display: block; }
#ctx-menu .item {
  padding: 6px 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: background-color var(--vsx-transition);
}
#ctx-menu .item:hover { background: var(--vsx-surface-hover); }
#ctx-menu .item.danger { color: var(--vsx-danger); }
#ctx-menu .item.danger:hover {
  background: color-mix(in srgb, var(--vsx-danger), transparent 90%);
}
#ctx-menu .item .ic { width: 14px; opacity: 0.7; }
#ctx-menu .sep { height: 1px; background: var(--vsx-border); margin: 4px 0; }
#ctx-menu .header {
  padding: 6px 14px 4px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--vscode-descriptionForeground);
}
      </style></head>
      <body>
        <div id="header">
          <input id="search" type="text" placeholder="Filter…" />
          <button id="refresh-btn" class="ghost" title="Refresh schemas">↻</button>
        </div>
        <div id="list"></div>
        <div id="footer">
          <button id="add-btn" class="primary">+ Add Connection</button>
        </div>
        <div id="ctx-menu"></div>
        <script nonce="${nonce}" src="${src}"></script>
      </body></html>`;
  }
}
