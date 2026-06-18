import * as vscode from "vscode";
import { getDesignTokensCss } from "../ui/styles";
import type { ConnectionStore } from "../connections/store";
import type { SchemaCache } from "../connections/schema-cache";
import { ErdLayoutStore } from "./layout-store";
import {
  isWebviewMessage,
  type HostMessage,
  type LayoutMap,
  type WebviewMessage,
} from "./protocol";

export interface ErdCallbacks {
  onOpenTable: (
    profileId: string,
    database: string,
    schema: string,
    table: string,
    isView: boolean,
  ) => void | Promise<void>;
}

export class ErdPanel {
  private static current: ErdPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly layoutStore: ErdLayoutStore;

  static show(
    context: vscode.ExtensionContext,
    store: ConnectionStore,
    schemaCache: SchemaCache,
    profileId: string,
    callbacks: ErdCallbacks,
  ): ErdPanel {
    if (ErdPanel.current) {
      ErdPanel.current.panel.reveal();
      void ErdPanel.current.loadFor(profileId);
      return ErdPanel.current;
    }
    ErdPanel.current = new ErdPanel(context, store, schemaCache, profileId, callbacks);
    return ErdPanel.current;
  }

  private constructor(
    context: vscode.ExtensionContext,
    private readonly store: ConnectionStore,
    private readonly schemaCache: SchemaCache,
    private profileId: string,
    private readonly callbacks: ErdCallbacks,
  ) {
    this.layoutStore = new ErdLayoutStore(context.globalState);
    const profile = store.get(profileId);
    this.panel = vscode.window.createWebviewPanel(
      "vsSqlEditor.erd",
      `ERD — ${profile?.name ?? "Schema"}`,
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
      ErdPanel.current = undefined;
    });
  }

  private async loadFor(profileId: string): Promise<void> {
    this.profileId = profileId;
    const profile = this.store.get(profileId);
    if (!profile) {
      this.post({ type: "schemaError", message: "Connection not found." });
      return;
    }
    this.panel.title = `ERD — ${profile.name}`;
    try {
      const model = await this.schemaCache.get(profileId);
      const layout = this.layoutStore.get(profileId);
      this.post({
        type: "state",
        connectionName: profile.name,
        engine: profile.engine,
        model,
        layout,
      });
    } catch (err) {
      this.post({ type: "schemaError", message: (err as Error).message });
    }
  }

  private post(m: HostMessage): void {
    void this.panel.webview.postMessage(m);
  }

  private async handle(m: WebviewMessage): Promise<void> {
    if (m.type === "ready") {
      await this.loadFor(this.profileId);
      return;
    }
    if (m.type === "saveLayout") {
      await this.layoutStore.save(this.profileId, m.layout as LayoutMap);
      return;
    }
    if (m.type === "resetLayout") {
      await this.layoutStore.clear(this.profileId);
      await this.loadFor(this.profileId);
      return;
    }
    if (m.type === "openTable") {
      await this.callbacks.onOpenTable(
        this.profileId,
        m.database,
        m.schema,
        m.table,
        m.isView,
      );
      return;
    }
  }

  private html(extensionUri: vscode.Uri): string {
    const nonce = Buffer.from(`${Date.now()}-${Math.random()}`).toString("base64").slice(0, 16);
    const src = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "dist", "erd.js"),
    );
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    return `<!DOCTYPE html><html><head>
      <meta http-equiv="Content-Security-Policy" content="${csp}">
      <style>
${getDesignTokensCss()}

html, body { height: 100%; }
body { display: flex; flex-direction: column; padding: 0; overflow: hidden; }

#toolbar {
  display: flex;
  align-items: center;
  gap: var(--vsx-gap-sm);
  padding: var(--vsx-gap-sm) var(--vsx-gap-md);
  border-bottom: 1px solid var(--vsx-border);
  background: var(--vsx-surface);
  flex-shrink: 0;
  font-size: 12px;
}
#toolbar .spacer { flex: 1; }
#toolbar input[type="text"] { height: 26px; font-size: 12px; width: 200px; }
#toolbar button { height: 26px; padding: 0 10px; font-size: 12px; }
#zoom-info { color: var(--vscode-descriptionForeground); min-width: 48px; text-align: center; }

#canvas-wrap {
  flex: 1;
  overflow: hidden;
  position: relative;
  background-image:
    linear-gradient(var(--vsx-border) 1px, transparent 1px),
    linear-gradient(90deg, var(--vsx-border) 1px, transparent 1px);
  background-size: 28px 28px;
  background-position: -1px -1px;
}
#canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  cursor: grab;
}
#canvas.panning { cursor: grabbing; }

.err {
  padding: var(--vsx-gap-md) var(--vsx-gap-xl);
  color: var(--vscode-errorForeground);
  white-space: pre-wrap;
}
.placeholder {
  padding: var(--vsx-gap-xl);
  color: var(--vscode-descriptionForeground);
  font-style: italic;
}

/* SVG node styling */
.node-bg {
  fill: var(--vsx-surface);
  stroke: var(--vsx-border-strong);
  stroke-width: 1;
}
.node-header {
  fill: var(--engine-accent, var(--vsx-accent-postgres));
  opacity: 0.95;
}
.node-title {
  fill: white;
  font-weight: 600;
  font-size: 12.5px;
  pointer-events: none;
}
.node-col {
  fill: var(--vscode-foreground);
  font-size: 11.5px;
  font-family: var(--vscode-editor-font-family);
  pointer-events: none;
}
.node-col-type {
  fill: var(--vscode-descriptionForeground);
  font-size: 10.5px;
  pointer-events: none;
}
.col-row.match rect { fill: var(--vsx-surface-hover); }
.col-row:hover rect { fill: var(--vsx-surface-hover); }
.pk-glyph { fill: var(--vscode-charts-yellow, #d29922); font-size: 10px; pointer-events: none; }

.fk-line {
  fill: none;
  stroke: var(--vsx-border-strong);
  stroke-width: 1.4;
  opacity: 0.85;
}
.fk-line.highlight {
  stroke: var(--engine-accent, var(--vsx-accent-postgres));
  stroke-width: 2;
  opacity: 1;
}
.node-group { cursor: grab; }
.node-group.dragging { cursor: grabbing; }
.node-group.match .node-bg { stroke: var(--vscode-focusBorder); stroke-width: 2; }
      </style></head>
      <body>
        <div id="toolbar">
          <input id="search" type="text" placeholder="Find table…" />
          <span class="spacer"></span>
          <button id="zoom-out" class="ghost" title="Zoom out">−</button>
          <span id="zoom-info">100%</span>
          <button id="zoom-in" class="ghost" title="Zoom in">+</button>
          <button id="fit" class="ghost" title="Fit to screen">⤢</button>
          <button id="reset" class="ghost" title="Reset layout">↺</button>
          <button id="download" class="ghost" title="Download SVG">⤓</button>
        </div>
        <div id="canvas-wrap">
          <div class="placeholder" id="placeholder">Loading schema…</div>
          <svg id="canvas" xmlns="http://www.w3.org/2000/svg" style="display:none">
            <defs>
              <marker id="fk-arrow" viewBox="0 -5 10 10" refX="9" refY="0"
                      markerWidth="8" markerHeight="8" orient="auto">
                <path d="M0,-5L10,0L0,5" fill="var(--vsx-border-strong)" />
              </marker>
              <marker id="fk-arrow-hi" viewBox="0 -5 10 10" refX="9" refY="0"
                      markerWidth="8" markerHeight="8" orient="auto">
                <path d="M0,-5L10,0L0,5" />
              </marker>
            </defs>
            <g id="viewport"></g>
          </svg>
        </div>
        <script nonce="${nonce}" src="${src}"></script>
      </body></html>`;
  }
}
