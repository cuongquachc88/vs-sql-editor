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
      if (ResultsPanel.current === this) ResultsPanel.current = undefined;
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

/* ── Toolbar ─────────────────────────────────────────────────────────────── */
#toolbar {
  display: flex;
  align-items: center;
  gap: var(--vsx-gap-xs);
  padding: 6px var(--vsx-gap-md);
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
  border-radius: var(--vsx-radius-sm);
}
#find { width: 190px; }
#find-count {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  min-width: 56px;
}
#page-input { width: 48px; text-align: center; }
#page-total {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}
#toolbar button {
  height: 26px;
  padding: 0 10px;
  font-size: 11.5px;
  border-radius: var(--vsx-radius-sm);
}

/* ── Hint bar ────────────────────────────────────────────────────────────── */
#hint {
  padding: 3px var(--vsx-gap-md);
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
  font-style: italic;
  opacity: 0.65;
  min-height: 0;
  display: none;
  background: color-mix(in srgb, var(--vsx-accent), transparent 95%);
  border-bottom: 1px solid color-mix(in srgb, var(--vsx-accent), transparent 88%);
}
#hint.show { display: block; }

/* ── Content area ────────────────────────────────────────────────────────── */
#content {
  flex: 1;
  overflow: auto;
  position: relative;
  padding: var(--vsx-gap-sm);
}
.placeholder, .empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 72px var(--vsx-gap-xl);
  text-align: center;
  color: var(--vscode-descriptionForeground);
  gap: var(--vsx-gap-sm);
}
.empty-state .glyph {
  font-size: 40px;
  opacity: 0.25;
  margin-bottom: var(--vsx-gap-xs);
}
.empty-state .title {
  font-size: 14px;
  font-weight: 600;
  color: var(--vscode-foreground);
  letter-spacing: -0.01em;
}
.empty-state .hint {
  font-size: 12px;
  max-width: 340px;
  line-height: 1.6;
  opacity: 0.8;
}
.err {
  padding: var(--vsx-gap-md) var(--vsx-gap-lg);
  margin: var(--vsx-gap-sm);
  color: var(--vscode-errorForeground);
  white-space: pre-wrap;
  font-family: var(--vscode-editor-font-family);
  background: color-mix(in srgb, var(--vsx-danger), transparent 92%);
  border: 1px solid color-mix(in srgb, var(--vsx-danger), transparent 75%);
  border-left: 3px solid var(--vsx-danger);
  border-radius: var(--vsx-radius);
  font-size: 12px;
  line-height: 1.6;
}

/* ── Grid wrapper ────────────────────────────────────────────────────────── */
.grid-wrap {
  border: 1px solid var(--vsx-border);
  border-radius: var(--vsx-radius-lg);
  overflow: auto;
  background: var(--vscode-editor-background);
  box-shadow: var(--vsx-shadow-sm);
  max-height: 100%;
}

/* ── Table ───────────────────────────────────────────────────────────────── */
table.grid {
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12.5px;
  table-layout: fixed;
  width: max-content;
}
table.grid th, table.grid td {
  border-right: 1px solid var(--vsx-border);
  border-bottom: 1px solid var(--vsx-border);
  padding: 7px 12px;
  vertical-align: middle;
  text-overflow: ellipsis;
  white-space: nowrap;
  position: relative;
  transition: background-color var(--vsx-transition);
}
table.grid td { overflow: hidden; }
table.grid th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--vsx-surface);
  text-align: left;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
  cursor: pointer;
  user-select: none;
  padding: 9px 12px;
}
table.grid th:hover { background: var(--vsx-surface-hover); }
table.grid th .colname { display: inline-block; font-weight: 600; }

/* ── Type chips ──────────────────────────────────────────────────────────── */
table.grid th .type-chip {
  display: inline-block;
  margin-left: 7px;
  padding: 2px 7px;
  font-size: 10px;
  font-weight: 600;
  text-transform: lowercase;
  letter-spacing: 0.03em;
  border-radius: 999px;
  vertical-align: middle;
  white-space: nowrap;
  border: 1px solid transparent;
}
.type-chip.t-text     { color: #16a34a; background: color-mix(in srgb, #16a34a, transparent 90%); border-color: color-mix(in srgb, #16a34a, transparent 78%); }
.type-chip.t-number   { color: #2563eb; background: color-mix(in srgb, #2563eb, transparent 90%); border-color: color-mix(in srgb, #2563eb, transparent 78%); }
.type-chip.t-datetime { color: #7c3aed; background: color-mix(in srgb, #7c3aed, transparent 90%); border-color: color-mix(in srgb, #7c3aed, transparent 78%); }
.type-chip.t-uuid     { color: #0891b2; background: color-mix(in srgb, #0891b2, transparent 90%); border-color: color-mix(in srgb, #0891b2, transparent 78%); }
.type-chip.t-json     { color: #ea580c; background: color-mix(in srgb, #ea580c, transparent 90%); border-color: color-mix(in srgb, #ea580c, transparent 78%); }
.type-chip.t-bool     { color: #ca8a04; background: color-mix(in srgb, #ca8a04, transparent 90%); border-color: color-mix(in srgb, #ca8a04, transparent 78%); }
.type-chip.t-binary   { color: #64748b; background: color-mix(in srgb, #64748b, transparent 88%); border-color: color-mix(in srgb, #64748b, transparent 74%); }
.type-chip.t-other    { color: var(--vscode-descriptionForeground); background: var(--vsx-surface-active); }

/* ── Sort indicator ──────────────────────────────────────────────────────── */
table.grid th .sort {
  margin-left: 5px;
  color: var(--vscode-descriptionForeground);
  font-size: 10px;
  opacity: 0;
  transition: opacity var(--vsx-transition);
}
table.grid th:hover .sort { opacity: 0.5; }
table.grid th.sorted .sort { opacity: 1; color: var(--vsx-accent); }

/* ── Column resizer ──────────────────────────────────────────────────────── */
table.grid th .resizer {
  position: absolute;
  right: 0; top: 0; bottom: 0;
  width: 8px;
  cursor: col-resize;
  user-select: none;
  z-index: 5;
  display: flex;
  align-items: stretch;
  justify-content: flex-end;
  background: transparent;
}
table.grid th .resizer::after {
  content: "";
  display: block;
  width: 2px;
  background: var(--vsx-border);
  opacity: 0.5;
  transition: background-color var(--vsx-transition), opacity var(--vsx-transition), width var(--vsx-transition);
}
table.grid th .resizer:hover::after,
table.grid th .resizer.dragging::after {
  background: var(--vsx-accent);
  opacity: 1;
  width: 3px;
}

/* ── Row states ──────────────────────────────────────────────────────────── */
table.grid tbody tr:nth-child(even) td {
  background: color-mix(in srgb, var(--vscode-editor-background), var(--vscode-foreground) 1.5%);
}
table.grid tbody tr:hover td {
  background: color-mix(in srgb, var(--vscode-editor-background), var(--vscode-foreground) 4.5%);
}
table.grid tbody tr.current td {
  background: color-mix(in srgb, var(--vsx-accent), transparent 91%);
}

/* ── Gutter (row numbers) ────────────────────────────────────────────────── */
table.grid td.gutter,
table.grid th.gutter {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--vsx-surface);
  color: var(--vscode-descriptionForeground);
  font-size: 10.5px;
  text-align: right;
  user-select: none;
  width: 52px;
  min-width: 52px;
}
table.grid th.gutter { z-index: 3; }
table.grid td.gutter { font-variant-numeric: tabular-nums; padding-right: 10px; opacity: 0.6; }

/* ── Cell types ──────────────────────────────────────────────────────────── */
table.grid td.numeric  { text-align: right; font-variant-numeric: tabular-nums; font-family: var(--vscode-editor-font-family, ui-monospace); }
table.grid td.datetime { font-variant-numeric: tabular-nums; color: color-mix(in srgb, var(--vscode-foreground), #7c3aed 28%); }
table.grid td.uuid     { font-family: var(--vscode-editor-font-family, ui-monospace); color: color-mix(in srgb, var(--vscode-foreground), #0891b2 32%); font-size: 11.5px; }

/* ── Cell value renderers ────────────────────────────────────────────────── */
table.grid td .null {
  display: inline-block;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 500;
  color: var(--vscode-descriptionForeground);
  background: var(--vsx-surface-2);
  border: 1px solid var(--vsx-border);
  border-radius: var(--vsx-radius-sm);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.6;
}
table.grid td .bool {
  display: inline-block;
  padding: 2px 9px;
  font-size: 10px;
  font-weight: 600;
  border-radius: 999px;
  letter-spacing: 0.03em;
}
table.grid td .bool.t-true  { color: #16a34a; background: color-mix(in srgb, #16a34a, transparent 88%); }
table.grid td .bool.t-false { color: #dc2626; background: color-mix(in srgb, #dc2626, transparent 88%); }
table.grid td .json {
  display: inline-block;
  padding: 1px 7px;
  font-family: var(--vscode-editor-font-family);
  font-size: 11px;
  background: color-mix(in srgb, #ea580c, transparent 93%);
  border: 1px solid color-mix(in srgb, #ea580c, transparent 82%);
  border-radius: var(--vsx-radius-sm);
  max-width: 100%;
  color: #ea580c;
}
table.grid td.match {
  outline: 2px solid color-mix(in srgb, #f59e0b, transparent 40%);
  outline-offset: -2px;
}
table.grid td.editable:focus-within { background: var(--vsx-surface-2); }
table.grid td .cell-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 2px solid var(--vsx-accent);
  box-shadow: 0 0 0 3px var(--vsx-accent-subtle);
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  padding: 2px 10px;
  font: inherit;
  outline: none;
  z-index: 4;
  border-radius: 0;
}

/* ── Status bar ──────────────────────────────────────────────────────────── */
#statusbar {
  display: flex;
  align-items: center;
  gap: var(--vsx-gap-md);
  padding: 5px var(--vsx-gap-md);
  border-top: 1px solid var(--vsx-border);
  background: var(--vsx-surface);
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  flex-shrink: 0;
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
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--vsx-success), transparent 75%);
}

/* ── Context menu ────────────────────────────────────────────────────────── */
#context-menu {
  position: fixed;
  background: var(--vsx-surface);
  border: 1px solid var(--vsx-border-strong);
  border-radius: var(--vsx-radius-lg);
  padding: 6px 0;
  font-size: 12.5px;
  box-shadow: var(--vsx-shadow-lg);
  z-index: 100;
  display: none;
  min-width: 168px;
  backdrop-filter: blur(8px);
}
#context-menu.show { display: block; }
#context-menu .item {
  padding: 7px 16px;
  cursor: pointer;
  transition: background-color var(--vsx-transition);
}
#context-menu .item:hover { background: var(--vsx-surface-hover); }
#context-menu .sep {
  height: 1px;
  background: var(--vsx-border);
  margin: 5px 0;
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
