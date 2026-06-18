import * as vscode from "vscode";
import { getDesignTokensCss } from "../ui/styles";
import { isWebviewMessage, type HostMessage, type WebviewMessage } from "./protocol";

export class ResultsPanel {
  private static current: ResultsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private onMessage?: (m: WebviewMessage) => void;

  static isOpen(): boolean {
    return ResultsPanel.current !== undefined;
  }

  static show(
    context: vscode.ExtensionContext,
    column: vscode.ViewColumn = vscode.ViewColumn.Beside,
  ): ResultsPanel {
    if (ResultsPanel.current) {
      // Reveal in its existing column, never re-position — avoids visual flicker
      // and prevents us from undoing the user's manual layout adjustments.
      ResultsPanel.current.panel.reveal(undefined, true);
      return ResultsPanel.current;
    }
    ResultsPanel.current = new ResultsPanel(context, column, "SQL Results");
    return ResultsPanel.current;
  }

  // Create a NEW results panel (not the singleton). Used when running multiple
  // SQL statements so each statement gets its own tab.
  static createNew(
    context: vscode.ExtensionContext,
    column: vscode.ViewColumn,
    title: string,
  ): ResultsPanel {
    return new ResultsPanel(context, column, title);
  }

  private constructor(
    context: vscode.ExtensionContext,
    column: vscode.ViewColumn,
    title: string,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "vsSqlEditor.results",
      title,
      { viewColumn: column, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
      },
    );
    this.panel.webview.html = this.html(context.extensionUri);
    this.panel.webview.onDidReceiveMessage((m) => {
      if (isWebviewMessage(m)) this.onMessage?.(m);
    });
    this.panel.onDidDispose(() => {
      ResultsPanel.current = undefined;
    });
  }

  setMessageHandler(fn: (m: WebviewMessage) => void): void {
    this.onMessage = fn;
  }

  post(message: HostMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private html(extensionUri: vscode.Uri): string {
    const nonce = Buffer.from(`${Date.now()}-${Math.random()}`).toString("base64").slice(0, 16);
    const src = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "dist", "webview.js"),
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

#toolbar {
  display: flex;
  align-items: center;
  gap: var(--vsx-gap-sm);
  padding: var(--vsx-gap-sm) var(--vsx-gap-md);
  border-bottom: 1px solid var(--vsx-border);
  background: var(--vsx-surface);
  flex-shrink: 0;
}
#toolbar .group {
  display: flex;
  align-items: center;
  gap: var(--vsx-gap-xs);
}
#toolbar .spacer { flex: 1; }
#toolbar input[type="text"], #toolbar input[type="number"] {
  height: 26px;
  font-size: 12px;
}
#find { width: 180px; }
#find-count {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  min-width: 60px;
}
#page-input { width: 50px; text-align: center; }
#page-total {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  margin-right: var(--vsx-gap-xs);
}
#toolbar button {
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
}

#hint {
  padding: 2px var(--vsx-gap-md);
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
  font-style: italic;
  opacity: 0.7;
  min-height: 0;
  display: none;
}
#hint.show { display: block; }

#content {
  flex: 1;
  overflow: auto;
  position: relative;
  padding: var(--vsx-gap-sm) var(--vsx-gap-sm) 0;
}
.placeholder, .empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px var(--vsx-gap-xl);
  text-align: center;
  color: var(--vscode-descriptionForeground);
  gap: var(--vsx-gap-sm);
}
.empty-state .glyph {
  font-size: 38px;
  opacity: 0.35;
  margin-bottom: var(--vsx-gap-xs);
}
.empty-state .title {
  font-size: 13px;
  font-weight: 600;
  color: var(--vscode-foreground);
}
.empty-state .hint { font-size: 12px; max-width: 320px; line-height: 1.5; }
.err {
  padding: var(--vsx-gap-md) var(--vsx-gap-xl);
  margin: var(--vsx-gap-sm);
  color: var(--vscode-errorForeground);
  white-space: pre-wrap;
  font-family: var(--vscode-editor-font-family);
  background: color-mix(in srgb, var(--vsx-danger), transparent 90%);
  border: 1px solid color-mix(in srgb, var(--vsx-danger), transparent 70%);
  border-radius: var(--vsx-radius);
  font-size: 12px;
}

/* Grid container — Outerbase/Supabase Studio-inspired: rounded edges, soft
 * borders, generous breathing room, refined hover states. */
.grid-wrap {
  border: 1px solid var(--vsx-border);
  border-radius: var(--vsx-radius);
  overflow: auto;
  background: var(--vscode-editor-background);
  /* Cap height so the panel's outer #content scroll handles vertical too. */
  max-height: 100%;
}

table.grid {
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12.5px;
  table-layout: fixed;
  /* width:max-content honors each <col>'s width strictly so column resize
   * actually changes the rendered width. No min-width so the table isn't
   * forced to fill the panel. */
  width: max-content;
}
table.grid th, table.grid td {
  border-right: 1px solid var(--vsx-border);
  border-bottom: 1px solid var(--vsx-border);
  padding: 6px 10px;
  vertical-align: middle;
  /* overflow:clip on the CONTENT only — keep the resizer span visible. */
  text-overflow: ellipsis;
  white-space: nowrap;
  position: relative;
  transition: background-color 80ms;
}
table.grid td {
  overflow: hidden;
}
table.grid th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--vsx-surface);
  text-align: left;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  padding: 8px 10px;
}
table.grid th:hover { background: var(--vsx-surface-hover); }
table.grid th .colname {
  display: inline-block;
  font-weight: 600;
}

/* Type chips — colored by category (Outerbase-style). */
table.grid th .type-chip {
  display: inline-block;
  margin-left: 8px;
  padding: 1px 7px;
  font-size: 10px;
  font-weight: 600;
  text-transform: lowercase;
  letter-spacing: 0.02em;
  border-radius: 4px;
  vertical-align: middle;
  white-space: nowrap;
  border: 1px solid transparent;
}
.type-chip.t-text     { color: #43a047; background: color-mix(in srgb, #43a047, transparent 88%); border-color: color-mix(in srgb, #43a047, transparent 72%); }
.type-chip.t-number   { color: #2196f3; background: color-mix(in srgb, #2196f3, transparent 88%); border-color: color-mix(in srgb, #2196f3, transparent 72%); }
.type-chip.t-datetime { color: #ab47bc; background: color-mix(in srgb, #ab47bc, transparent 88%); border-color: color-mix(in srgb, #ab47bc, transparent 72%); }
.type-chip.t-uuid     { color: #26a69a; background: color-mix(in srgb, #26a69a, transparent 88%); border-color: color-mix(in srgb, #26a69a, transparent 72%); }
.type-chip.t-json     { color: #ff7043; background: color-mix(in srgb, #ff7043, transparent 88%); border-color: color-mix(in srgb, #ff7043, transparent 72%); }
.type-chip.t-bool     { color: #d29922; background: color-mix(in srgb, #d29922, transparent 88%); border-color: color-mix(in srgb, #d29922, transparent 72%); }
.type-chip.t-binary   { color: #757575; background: color-mix(in srgb, #757575, transparent 86%); border-color: color-mix(in srgb, #757575, transparent 68%); }
.type-chip.t-other    { color: var(--vscode-descriptionForeground); background: var(--vsx-surface-active); }

table.grid th .sort {
  margin-left: 6px;
  color: var(--vscode-descriptionForeground);
  font-size: 10px;
  opacity: 0;
  transition: opacity 80ms;
}
table.grid th:hover .sort { opacity: 0.6; }
table.grid th.sorted .sort { opacity: 1; color: var(--vscode-foreground); }
/* Resizer fully inside the th's right edge so it's never clipped by
 * overflow:hidden, never positioned outside the cell's box, and always
 * captures mouse events. */
table.grid th .resizer {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 8px;
  cursor: col-resize;
  user-select: none;
  z-index: 5;
  display: flex;
  align-items: stretch;
  justify-content: flex-end;
  background: transparent;
}
/* Always-visible thin grip line at the very right edge so the user knows
 * where to drag. */
table.grid th .resizer::after {
  content: "";
  display: block;
  width: 3px;
  background: var(--vsx-border-strong);
  opacity: 0.6;
  transition: background-color 80ms, opacity 80ms, width 80ms;
}
table.grid th .resizer:hover::after,
table.grid th .resizer.dragging::after {
  background: var(--vscode-focusBorder, #2196f3);
  opacity: 1;
  width: 4px;
}

table.grid tbody tr:nth-child(even) td {
  background: color-mix(in srgb, var(--vscode-editor-background), var(--vscode-foreground) 1.5%);
}
table.grid tbody tr:hover td {
  background: color-mix(in srgb, var(--vscode-editor-background), var(--vscode-foreground) 5%);
}
table.grid tbody tr.current td {
  background: color-mix(in srgb, var(--vscode-focusBorder, #2196f3), transparent 88%);
}
table.grid td.gutter,
table.grid th.gutter {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--vsx-surface);
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
  text-align: right;
  user-select: none;
  width: 56px;
  min-width: 56px;
}
table.grid th.gutter { z-index: 3; }
table.grid td.gutter { font-variant-numeric: tabular-nums; padding-right: 12px; }
table.grid td.numeric { text-align: right; font-variant-numeric: tabular-nums; font-family: var(--vscode-editor-font-family, ui-monospace); }
table.grid td.datetime { font-variant-numeric: tabular-nums; color: color-mix(in srgb, var(--vscode-foreground), var(--vsx-accent-postgres) 30%); }
table.grid td.uuid { font-family: var(--vscode-editor-font-family, ui-monospace); color: color-mix(in srgb, var(--vscode-foreground), #26a69a 35%); }
table.grid td .null {
  display: inline-block;
  padding: 0 6px;
  font-size: 10px;
  font-weight: 500;
  color: var(--vscode-descriptionForeground);
  background: var(--vsx-surface-active);
  border-radius: 4px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.7;
}
table.grid td .bool {
  display: inline-block;
  padding: 1px 8px;
  font-size: 10px;
  font-weight: 600;
  border-radius: 999px;
}
table.grid td .bool.t-true {
  color: #43a047;
  background: color-mix(in srgb, #43a047, transparent 86%);
}
table.grid td .bool.t-false {
  color: #ef5350;
  background: color-mix(in srgb, #ef5350, transparent 86%);
}
table.grid td .json {
  display: inline-block;
  padding: 1px 6px;
  font-family: var(--vscode-editor-font-family);
  font-size: 11.5px;
  background: color-mix(in srgb, #ff7043, transparent 92%);
  border: 1px solid color-mix(in srgb, #ff7043, transparent 80%);
  border-radius: 4px;
  max-width: 100%;
}
table.grid td.match {
  outline: 2px solid var(--vscode-editor-findMatchHighlightBackground, rgba(255, 200, 0, 0.4));
  outline-offset: -2px;
}
table.grid td.editable:focus-within { background: var(--vsx-surface-active); }
table.grid td .cell-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 2px solid var(--vscode-focusBorder, #2196f3);
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  padding: 2px 7px;
  font: inherit;
  outline: none;
  z-index: 4;
}

#statusbar {
  display: flex;
  align-items: center;
  gap: var(--vsx-gap-md);
  padding: 4px var(--vsx-gap-md);
  border-top: 1px solid var(--vsx-border);
  background: var(--vsx-surface);
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  flex-shrink: 0;
  min-height: 22px;
}
#statusbar .spacer { flex: 1; }
#statusbar .dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--vsx-success);
  margin-right: var(--vsx-gap-xs);
  vertical-align: middle;
}

#context-menu {
  position: fixed;
  background: var(--vsx-surface);
  border: 1px solid var(--vsx-border-strong);
  border-radius: var(--vsx-radius);
  padding: 4px 0;
  font-size: 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.25);
  z-index: 100;
  display: none;
  min-width: 160px;
}
#context-menu.show { display: block; }
#context-menu .item {
  padding: 6px 14px;
  cursor: pointer;
}
#context-menu .item:hover { background: var(--vsx-surface-hover); }
#context-menu .sep {
  height: 1px;
  background: var(--vsx-border);
  margin: 4px 0;
}
      </style></head>
      <body>
        <div id="toolbar">
          <div class="group">
            <button id="prev" title="Previous page (PageUp)">◀</button>
            <input id="page-input" type="number" min="1" value="1" />
            <span id="page-total">/ 1</span>
            <button id="next" title="Next page (PageDown)">▶</button>
          </div>
          <div class="group">
            <input id="find" type="text" placeholder="Find in results…" />
            <span id="find-count"></span>
          </div>
          <div class="spacer"></div>
          <div class="group">
            <button id="csv">Export CSV</button>
            <button id="json">Export JSON</button>
          </div>
        </div>
        <div id="hint"></div>
        <div id="content">
          <div class="empty-state">
            <div class="glyph">▦</div>
            <div class="title">No results yet</div>
            <div class="hint">Run a query to see results here. Press <strong>F5</strong> or <strong>⌘↵</strong> in the editor above, or click <strong>▶</strong> at the title bar.</div>
          </div>
        </div>
        <div id="statusbar">
          <span><span class="dot" id="status-dot"></span><span id="status-conn">—</span></span>
          <span id="status-rows">—</span>
          <span id="status-time">—</span>
          <span class="spacer"></span>
          <span id="status-page">—</span>
        </div>
        <div id="context-menu"></div>
        <script nonce="${nonce}" src="${src}"></script>
      </body></html>`;
  }
}
