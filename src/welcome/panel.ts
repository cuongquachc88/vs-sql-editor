import * as vscode from "vscode";
import { getDesignTokensCss } from "../ui/styles";
import type { ConnectionStore } from "../connections/store";
import type { RecentQueries } from "../connections/recent-queries";
import type { EngineId } from "../drivers/types";
import {
  isWebviewMessage,
  type HostMessage,
  type WebviewMessage,
} from "./protocol";

export interface WelcomeCallbacks {
  getActiveProfileId: () => string | undefined;
  onAddConnection: () => void;
  onOpenConnection: (profileId: string) => void | Promise<void>;
  onOpenQuery: (sql: string, profileId?: string) => void | Promise<void>;
  onOpenSample: (engine: EngineId) => void | Promise<void>;
}

export class WelcomePanel {
  private static current: WelcomePanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  static show(
    context: vscode.ExtensionContext,
    store: ConnectionStore,
    recents: RecentQueries,
    callbacks: WelcomeCallbacks,
  ): WelcomePanel {
    if (WelcomePanel.current) {
      WelcomePanel.current.panel.reveal();
      WelcomePanel.current.postState();
      return WelcomePanel.current;
    }
    WelcomePanel.current = new WelcomePanel(context, store, recents, callbacks);
    return WelcomePanel.current;
  }

  private constructor(
    context: vscode.ExtensionContext,
    private readonly store: ConnectionStore,
    private readonly recents: RecentQueries,
    private readonly callbacks: WelcomeCallbacks,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "vsSqlEditor.welcome",
      "SQL Editor — Welcome",
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
      WelcomePanel.current = undefined;
    });
  }

  private postState(): void {
    const state: HostMessage = {
      type: "state",
      connections: this.store.list().map((p) => ({
        id: p.id,
        name: p.name,
        engine: p.engine,
        host: p.host,
        filePath: p.filePath,
        database: p.database,
      })),
      recents: this.recents.list().slice(0, 10),
      activeId: this.callbacks.getActiveProfileId(),
    };
    void this.panel.webview.postMessage(state);
  }

  private async handle(m: WebviewMessage): Promise<void> {
    if (m.type === "ready") {
      this.postState();
      return;
    }
    if (m.type === "addConnection") {
      this.callbacks.onAddConnection();
      return;
    }
    if (m.type === "openConnection") {
      await this.callbacks.onOpenConnection(m.profileId);
      return;
    }
    if (m.type === "openQuery") {
      await this.callbacks.onOpenQuery(m.sql, m.profileId);
      return;
    }
    if (m.type === "openSample") {
      await this.callbacks.onOpenSample(m.engine);
      return;
    }
    if (m.type === "clearRecents") {
      await this.recents.clear();
      this.postState();
      return;
    }
  }

  private html(extensionUri: vscode.Uri): string {
    const nonce = Buffer.from(`${Date.now()}-${Math.random()}`).toString("base64").slice(0, 16);
    const src = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "dist", "welcome.js"),
    );
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    return `<!DOCTYPE html><html><head>
      <meta http-equiv="Content-Security-Policy" content="${csp}">
      <style>
${getDesignTokensCss()}

body {
  padding: 48px 56px 80px;
  display: flex;
  justify-content: center;
}
.shell {
  width: 100%;
  max-width: 880px;
}

/* Hero */
.hero {
  display: flex;
  align-items: center;
  gap: var(--vsx-gap-lg);
  padding-bottom: var(--vsx-gap-xl);
  border-bottom: 1px solid var(--vsx-border);
}
.hero-logo {
  width: 56px;
  height: 56px;
  border-radius: var(--vsx-radius-lg);
  background: linear-gradient(135deg, var(--vsx-accent-postgres), var(--vsx-accent-mysql));
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 22px;
  color: white;
  letter-spacing: -1px;
}
.hero-text h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.hero-text p {
  margin: 4px 0 0;
  color: var(--vscode-descriptionForeground);
  font-size: 13px;
}
.hero-spacer { flex: 1; }
.hero .primary { height: 34px; padding: 0 18px; font-weight: 500; }

/* Sections */
.section { margin-top: var(--vsx-gap-xl); }
.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: var(--vsx-gap-md);
}
.section-head h2 {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vscode-descriptionForeground);
  margin: 0;
}
.section-head .link {
  font-size: 12px;
  color: var(--vscode-textLink-foreground, var(--vsx-accent-postgres));
  background: transparent;
  height: auto;
  padding: 0;
}
.section-head .link:hover { text-decoration: underline; background: transparent; }

/* Connection cards */
.conn-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--vsx-gap-md);
}
.conn-card {
  display: flex;
  flex-direction: column;
  gap: var(--vsx-gap-sm);
  padding: var(--vsx-gap-md);
  cursor: pointer;
  transition: border-color 100ms, background-color 100ms;
}
.conn-card:hover {
  background: var(--vsx-surface-hover);
}
.conn-card.active {
  border-color: var(--engine-accent);
}
.conn-card .top {
  display: flex;
  align-items: center;
  gap: var(--vsx-gap-sm);
}
.conn-card .name {
  font-weight: 500;
  font-size: 13.5px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}
.conn-card .name .dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--vsx-success);
  flex-shrink: 0;
}
.conn-card .engine {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  font-weight: 500;
}
.conn-card .meta {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  font-family: var(--vscode-editor-font-family);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.add-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--vsx-gap-xs);
  padding: var(--vsx-gap-lg);
  cursor: pointer;
  border-style: dashed;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}
.add-card:hover { background: var(--vsx-surface-hover); color: var(--vscode-foreground); }
.add-card .plus { font-size: 22px; font-weight: 300; }

/* Recents */
.recents { display: flex; flex-direction: column; gap: 2px; }
.recent {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: var(--vsx-gap-sm);
  padding: var(--vsx-gap-sm) var(--vsx-gap);
  border-radius: var(--vsx-radius);
  cursor: pointer;
}
.recent:hover { background: var(--vsx-surface-hover); }
.recent .dot-ok { width: 6px; height: 6px; border-radius: 999px; background: var(--vsx-success); }
.recent .dot-err { width: 6px; height: 6px; border-radius: 999px; background: var(--vsx-danger); }
.recent .sql {
  font-family: var(--vscode-editor-font-family);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.recent .conn-label {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  white-space: nowrap;
}
.recent .ago {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  white-space: nowrap;
  min-width: 70px;
  text-align: right;
}

/* Samples */
.samples {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--vsx-gap-sm);
}
.sample-card {
  display: flex;
  flex-direction: column;
  gap: var(--vsx-gap-xs);
  padding: var(--vsx-gap-md);
  cursor: pointer;
}
.sample-card:hover { background: var(--vsx-surface-hover); }
.sample-card .label { font-weight: 500; font-size: 12.5px; }
.sample-card .descr { font-size: 11px; color: var(--vscode-descriptionForeground); }

.empty {
  padding: var(--vsx-gap-xl);
  text-align: center;
  color: var(--vscode-descriptionForeground);
}
      </style></head>
      <body>
        <div class="shell">
          <div class="hero">
            <div class="hero-logo">SQL</div>
            <div class="hero-text">
              <h1>VS SQL Editor</h1>
              <p>Connect, explore, and edit data across Postgres, MySQL, SQLite, PGlite, ClickHouse.</p>
            </div>
            <div class="hero-spacer"></div>
            <button class="primary" id="add-hero">+ Add Connection</button>
          </div>
          <div class="subtitle" style="margin-top: var(--vsx-gap-md);">
            Quick actions: <code>SQL: AI — Ask in plain English</code> ·
            <code>SQL: Import CSV</code> · <code>SQL: Open ERD Diagram</code> from the command palette.
          </div>

          <section class="section">
            <div class="section-head">
              <h2>Your connections</h2>
            </div>
            <div class="conn-grid" id="conns"></div>
          </section>

          <section class="section">
            <div class="section-head">
              <h2>Recent queries</h2>
              <button class="link" id="clear-recents">Clear</button>
            </div>
            <div class="recents" id="recents"></div>
          </section>

          <section class="section">
            <div class="section-head">
              <h2>Try a sample</h2>
            </div>
            <div class="samples" id="samples"></div>
          </section>
        </div>
        <script nonce="${nonce}" src="${src}"></script>
      </body></html>`;
  }
}
