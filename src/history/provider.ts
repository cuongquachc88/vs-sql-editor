import * as vscode from "vscode";
import { getDesignTokensCss } from "../ui/styles";
import type { RecentQueries } from "../connections/recent-queries";
import type { SavedQueries } from "../connections/saved-queries";

export interface HistoryCallbacks {
  onOpenQuery: (sql: string, profileId?: string) => Promise<void> | void;
  onSaveQuery: (id: string, name: string, sql: string, profileId?: string, profileName?: string) => Promise<void> | void;
  onDeleteSaved: (id: string) => Promise<void> | void;
  onClearHistory: () => Promise<void> | void;
}

export class HistoryViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "vsSqlEditorHistory";
  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly recents: RecentQueries,
    private readonly saved: SavedQueries,
    private readonly callbacks: HistoryCallbacks,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.html();
    webviewView.webview.onDidReceiveMessage(async (m: WebviewMsg) => {
      switch (m.type) {
        case "openQuery":
          await this.callbacks.onOpenQuery(m.sql, m.profileId);
          break;
        case "saveQuery": {
          const name = await vscode.window.showInputBox({
            prompt: "Save query as…",
            placeHolder: "My query name",
            value: m.sql.split("\n")[0].replace(/^--\s*/, "").slice(0, 60) || "Untitled query",
          });
          if (!name) return;
          await this.callbacks.onSaveQuery(m.id, name, m.sql, m.profileId, m.profileName);
          this.refresh();
          break;
        }
        case "deleteSaved":
          await this.callbacks.onDeleteSaved(m.id);
          this.refresh();
          break;
        case "clearHistory":
          await this.callbacks.onClearHistory();
          this.refresh();
          break;
        case "renameSaved": {
          const name = await vscode.window.showInputBox({
            prompt: "Rename query",
            value: m.currentName,
          });
          if (!name) return;
          await this.saved.rename(m.id, name);
          this.refresh();
          break;
        }
      }
    });
  }

  refresh(): void {
    if (!this.view) return;
    this.view.webview.html = this.html();
  }

  private html(): string {
    const recents = this.recents.list();
    const savedList = this.saved.list();
    const tokens = getDesignTokensCss();

    const timeAgo = (ms: number): string => {
      const s = Math.round((Date.now() - ms) / 1000);
      if (s < 60) return `${s}s ago`;
      if (s < 3600) return `${Math.round(s / 60)}m ago`;
      if (s < 86400) return `${Math.round(s / 3600)}h ago`;
      return `${Math.round(s / 86400)}d ago`;
    };

    const savedRows = savedList.length === 0
      ? `<div class="empty">No saved queries yet.<br>Run a query then click ☆ to save it.</div>`
      : savedList.map((q) => `
        <div class="row" data-id="${esc(q.id)}" data-sql="${esc(q.sql)}" data-profile="${esc(q.profileId ?? "")}">
          <div class="sql-preview" title="${esc(q.sql)}">${esc(q.name)}</div>
          <div class="meta">${q.profileName ? esc(q.profileName) + " · " : ""}${timeAgo(q.createdAt)}</div>
          <div class="actions">
            <button class="icon-btn open-btn" title="Open in editor" data-id="${esc(q.id)}" data-sql="${esc(q.sql)}" data-profile="${esc(q.profileId ?? "")}">▶</button>
            <button class="icon-btn rename-btn" title="Rename" data-id="${esc(q.id)}" data-name="${esc(q.name)}">✎</button>
            <button class="icon-btn del-btn danger" title="Delete" data-id="${esc(q.id)}">✕</button>
          </div>
        </div>`).join("");

    const historyRows = recents.length === 0
      ? `<div class="empty">No history yet.<br>Run a query to populate history.</div>`
      : recents.map((q, i) => `
        <div class="row ${q.ok ? "" : "failed"}" data-idx="${i}">
          <div class="sql-preview" title="${esc(q.sql)}">${esc(q.sql.replace(/\s+/g, " ").slice(0, 120))}</div>
          <div class="meta">${esc(q.profileName)} · ${timeAgo(q.at)}${q.ok ? "" : " · failed"}</div>
          <div class="actions">
            <button class="icon-btn open-btn" title="Open in editor" data-sql="${esc(q.sql)}" data-profile="${esc(q.profileId)}">▶</button>
            <button class="icon-btn save-btn" title="Save query" data-sql="${esc(q.sql)}" data-profile="${esc(q.profileId)}" data-profile-name="${esc(q.profileName)}">☆</button>
          </div>
        </div>`).join("");

    return `<!DOCTYPE html><html><head>
<style>
${tokens}
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; padding: 0; font-size: 12px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: transparent; }
.section-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px 4px;
  font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em;
  color: var(--vscode-descriptionForeground);
  border-bottom: 1px solid var(--vsx-border);
  margin-top: 4px;
}
.section-header button { background: none; border: none; cursor: pointer; color: var(--vscode-descriptionForeground); font-size: 11px; padding: 0 2px; }
.section-header button:hover { color: var(--vscode-foreground); }
.row {
  display: flex; flex-direction: column; gap: 2px;
  padding: 6px 10px; border-bottom: 1px solid var(--vsx-border);
  cursor: pointer; transition: background .12s;
  position: relative;
}
.row:hover { background: var(--vsx-surface-hover); }
.row.failed .sql-preview { opacity: .5; }
.row.failed::before { content: "✗"; position: absolute; right: 78px; top: 8px; color: var(--vscode-errorForeground); font-size: 10px; }
.sql-preview {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  color: var(--vscode-foreground);
}
.meta { font-size: 10.5px; color: var(--vscode-descriptionForeground); }
.actions { display: flex; gap: 2px; position: absolute; right: 6px; top: 50%; transform: translateY(-50%); opacity: 0; transition: opacity .12s; }
.row:hover .actions { opacity: 1; }
.icon-btn {
  background: none; border: 1px solid var(--vsx-border); border-radius: 3px;
  cursor: pointer; color: var(--vscode-foreground); font-size: 11px;
  padding: 1px 5px; line-height: 1.4;
}
.icon-btn:hover { background: var(--vsx-surface-hover); }
.icon-btn.danger:hover { color: var(--vscode-errorForeground); border-color: var(--vscode-errorForeground); }
.empty { padding: 12px 10px; color: var(--vscode-descriptionForeground); font-size: 11.5px; line-height: 1.6; }
</style>
</head><body>

<div class="section-header">
  <span>Saved Queries</span>
</div>
<div id="saved">${savedRows}</div>

<div class="section-header">
  <span>History</span>
  ${recents.length > 0 ? `<button id="clear-history" title="Clear all history">Clear</button>` : ""}
</div>
<div id="history">${historyRows}</div>

<script>
const vscode = acquireVsCodeApi();

document.addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  e.stopPropagation();

  if (btn.id === 'clear-history') {
    vscode.postMessage({ type: 'clearHistory' });
    return;
  }
  if (btn.classList.contains('open-btn')) {
    vscode.postMessage({ type: 'openQuery', sql: btn.dataset.sql, profileId: btn.dataset.profile || undefined });
    return;
  }
  if (btn.classList.contains('save-btn')) {
    vscode.postMessage({ type: 'saveQuery', id: '', sql: btn.dataset.sql, profileId: btn.dataset.profile || undefined, profileName: btn.dataset.profileName || undefined });
    return;
  }
  if (btn.classList.contains('del-btn')) {
    vscode.postMessage({ type: 'deleteSaved', id: btn.dataset.id });
    return;
  }
  if (btn.classList.contains('rename-btn')) {
    vscode.postMessage({ type: 'renameSaved', id: btn.dataset.id, currentName: btn.dataset.name });
    return;
  }
});
</script>
</body></html>`;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

type WebviewMsg =
  | { type: "openQuery"; sql: string; profileId?: string }
  | { type: "saveQuery"; id: string; sql: string; profileId?: string; profileName?: string }
  | { type: "deleteSaved"; id: string }
  | { type: "clearHistory" }
  | { type: "renameSaved"; id: string; currentName: string };
