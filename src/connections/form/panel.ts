import * as vscode from "vscode";
import type { ConnectionProfile, EngineId } from "../../drivers/types";
import type { ConnectionStore } from "../store";
import { runConnectionTest } from "./test";
import { getDesignTokensCss } from "../../ui/styles";
import { getEngineSvg } from "../../ui/engine-icons";
import { ENGINE_IDS, ENGINE_LABELS } from "../../drivers/defaults";
import {
  isWebviewMessage,
  type FormMode,
  type FormProfile,
  type HostMessage,
  type WebviewMessage,
} from "./protocol";

interface OpenArgs {
  mode: FormMode;
  // For edit/duplicate, the source profile to prefill from.
  source?: ConnectionProfile;
}

export interface ConnectionFormDeps {
  store: ConnectionStore;
  onSaved: (profile: ConnectionProfile) => void;
}

// Singleton webview panel hosting the connection form. Mirrors ResultsPanel.
export class ConnectionFormPanel {
  private static current: ConnectionFormPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private mode: FormMode;
  private source: ConnectionProfile | undefined;

  static show(
    context: vscode.ExtensionContext,
    deps: ConnectionFormDeps,
    args: OpenArgs,
  ): ConnectionFormPanel {
    if (ConnectionFormPanel.current) {
      ConnectionFormPanel.current.reopen(args);
      ConnectionFormPanel.current.panel.reveal();
      return ConnectionFormPanel.current;
    }
    ConnectionFormPanel.current = new ConnectionFormPanel(context, deps, args);
    return ConnectionFormPanel.current;
  }

  private constructor(
    context: vscode.ExtensionContext,
    private readonly deps: ConnectionFormDeps,
    args: OpenArgs,
  ) {
    this.mode = args.mode;
    this.source = args.source;
    this.panel = vscode.window.createWebviewPanel(
      "vsSqlEditor.connectionForm",
      this.title(),
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
      ConnectionFormPanel.current = undefined;
    });
  }

  private reopen(args: OpenArgs): void {
    this.mode = args.mode;
    this.source = args.source;
    this.panel.title = this.title();
    void this.postInit();
  }

  private title(): string {
    if (this.mode === "edit") return `Edit ${this.source?.name ?? "Connection"}`;
    if (this.mode === "duplicate") return `Duplicate ${this.source?.name ?? "Connection"}`;
    return "Add Connection";
  }

  private post(m: HostMessage): void {
    void this.panel.webview.postMessage(m);
  }

  private async postInit(): Promise<void> {
    const profile = this.initialProfile();
    const hasExistingSecret =
      this.mode === "edit" && this.source
        ? Boolean(await this.deps.store.getSecret(this.source.id))
        : false;
    this.post({ type: "init", mode: this.mode, profile, hasExistingSecret });
  }

  private initialProfile(): FormProfile | undefined {
    if (!this.source) return undefined;
    const { id, ...rest } = this.source;
    void id;
    if (this.mode === "duplicate") {
      return { ...rest, name: `${rest.name} (copy)` };
    }
    return rest;
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
    if (m.type === "pickFile") {
      const uri = await vscode.window.showOpenDialog({
        canSelectFiles: m.engine === "sqlite",
        canSelectFolders: m.engine === "pglite",
        canSelectMany: false,
        openLabel: m.engine === "sqlite" ? "Select database file" : "Select PGlite directory",
      });
      if (uri && uri[0]) this.post({ type: "filePicked", path: uri[0].fsPath });
      return;
    }
    if (m.type === "test") {
      const result = await runConnectionTest(m.profile, m.secret);
      this.post(
        result.ok
          ? { type: "testResult", ok: true }
          : { type: "testResult", ok: false, error: result.error },
      );
      return;
    }
    if (m.type === "save") {
      try {
        const saved = await this.save(m);
        this.deps.onSaved(saved);
        this.panel.dispose();
      } catch (err) {
        this.post({ type: "saveError", message: (err as Error).message });
      }
      return;
    }
  }

  private async save(m: Extract<WebviewMessage, { type: "save" }>): Promise<ConnectionProfile> {
    const { profile, secret, clearSecret } = m;
    if (this.mode === "edit" && this.source) {
      const secretArg = clearSecret ? null : secret;
      return this.deps.store.update(
        this.source.id,
        {
          name: profile.name,
          host: profile.host,
          port: profile.port,
          database: profile.database,
          user: profile.user,
          filePath: profile.filePath,
          options: profile.options,
        },
        secretArg,
      );
    }
    // add and duplicate both end up as a fresh add()
    return this.deps.store.add(profile, secret);
  }

  private html(extensionUri: vscode.Uri): string {
    const nonce = Buffer.from(`${Date.now()}-${Math.random()}`).toString("base64").slice(0, 16);
    const src = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "dist", "connection-form.js"),
    );
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    const engineCards = ENGINE_IDS.map(
      (e: EngineId) => `
      <button type="button" class="engine-card" data-engine="${e}" data-accent="var(--vsx-accent-${e})">
        <div class="engine-svg">${getEngineSvg(e, 36)}</div>
        <div class="engine-label">${ENGINE_LABELS[e]}</div>
      </button>`,
    ).join("");

    return `<!DOCTYPE html><html><head>
      <meta http-equiv="Content-Security-Policy" content="${csp}">
      <style>
${getDesignTokensCss()}

body {
  padding: var(--vsx-gap-xl) var(--vsx-gap-xl) var(--vsx-gap-lg);
  display: flex;
  justify-content: center;
}
.shell {
  width: 100%;
  max-width: 720px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: var(--vsx-gap);
  margin-bottom: var(--vsx-gap-xs);
}
.title-row h1 {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  letter-spacing: -0.01em;
}
.subtitle {
  color: var(--vscode-descriptionForeground);
  font-size: 12.5px;
  margin-bottom: var(--vsx-gap-xl);
}

section { margin-bottom: var(--vsx-gap-lg); }
.section-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vscode-descriptionForeground);
  margin-bottom: var(--vsx-gap-sm);
}

.engine-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: var(--vsx-gap-sm);
}
.engine-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--vsx-gap-xs);
  padding: var(--vsx-gap) var(--vsx-gap-xs);
  height: auto;
  background: var(--vsx-surface);
  border: 1.5px solid var(--vsx-border);
  border-radius: var(--vsx-radius);
  cursor: pointer;
  transition: border-color 100ms, background-color 100ms;
}
.engine-card:hover { background: var(--vsx-surface-hover); }
.engine-card.selected {
  border-color: var(--engine-accent, var(--vscode-focusBorder));
  background: color-mix(in srgb, var(--engine-accent, var(--vsx-surface-hover)), transparent 88%);
}
.engine-svg { display: flex; }
.engine-label {
  font-size: 11px;
  font-weight: 500;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
}

.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--vsx-gap) var(--vsx-gap-md);
}
.field { display: flex; flex-direction: column; gap: 4px; }
.field.span-2 { grid-column: 1 / -1; }
.field label {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}
.file-row { display: flex; gap: var(--vsx-gap-xs); }
.file-row input { flex: 1; }
.field-hint {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  margin-top: 2px;
}

details.advanced {
  margin-top: var(--vsx-gap-md);
  border-top: 1px solid var(--vsx-border);
  padding-top: var(--vsx-gap-md);
}
details.advanced summary {
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vscode-descriptionForeground);
  list-style: none;
  display: flex;
  align-items: center;
  gap: var(--vsx-gap-xs);
}
details.advanced summary::-webkit-details-marker { display: none; }
details.advanced summary::before {
  content: "▸";
  display: inline-block;
  transition: transform 100ms;
  font-size: 9px;
}
details.advanced[open] summary::before { transform: rotate(90deg); }
details.advanced .advanced-body {
  margin-top: var(--vsx-gap-md);
  display: flex;
  flex-direction: column;
  gap: var(--vsx-gap-sm);
}
.opt-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: var(--vsx-gap-xs);
}
.opt-row button { padding: 0 8px; }

.actions {
  display: flex;
  gap: var(--vsx-gap-sm);
  margin-top: var(--vsx-gap-xl);
  padding-top: var(--vsx-gap-md);
  border-top: 1px solid var(--vsx-border);
  align-items: center;
}
.actions .spacer { flex: 1; }

#status {
  margin-top: var(--vsx-gap-md);
  padding: var(--vsx-gap-sm) var(--vsx-gap);
  border-radius: var(--vsx-radius);
  font-size: 12px;
  display: none;
  white-space: pre-wrap;
  display: none;
}
#status.ok {
  display: block;
  background: color-mix(in srgb, var(--vsx-success), transparent 80%);
  color: var(--vsx-success);
  border: 1px solid color-mix(in srgb, var(--vsx-success), transparent 60%);
}
#status.err {
  display: block;
  background: color-mix(in srgb, var(--vsx-danger), transparent 85%);
  color: var(--vsx-danger);
  border: 1px solid color-mix(in srgb, var(--vsx-danger), transparent 60%);
}

[hidden] { display: none !important; }
      </style></head>
      <body>
        <div class="shell">
          <div class="title-row">
            <h1 id="title">Add Connection</h1>
          </div>
          <div class="subtitle" id="subtitle">Pick an engine to get started.</div>

          <form id="form" autocomplete="off">
            <section>
              <div class="section-label">Engine</div>
              <div class="engine-grid" id="engine-grid">${engineCards}</div>
            </section>

            <section>
              <div class="section-label">Connection</div>
              <div class="grid-2">
                <div class="field span-2">
                  <label for="name">Name</label>
                  <input id="name" required placeholder="e.g. Production read-replica" />
                </div>

                <div class="field span-2" data-group="file">
                  <label for="filePath" id="filePathLabel">File</label>
                  <div class="file-row">
                    <input id="filePath" />
                    <button type="button" id="browse" class="ghost">Browse…</button>
                  </div>
                  <div class="field-hint" id="fileHint"></div>
                </div>

                <div class="field" data-group="net">
                  <label for="host">Host</label>
                  <input id="host" placeholder="localhost" />
                </div>
                <div class="field" data-group="net">
                  <label for="port">Port</label>
                  <input id="port" type="number" />
                </div>
                <div class="field span-2" data-group="net">
                  <label for="database">Database</label>
                  <input id="database" />
                </div>
                <div class="field" data-group="net">
                  <label for="user">User</label>
                  <input id="user" />
                </div>
                <div class="field" data-group="net">
                  <label for="password">Password</label>
                  <input id="password" type="password" />
                </div>
              </div>

              <details class="advanced" id="advanced">
                <summary>Advanced</summary>
                <div class="advanced-body">
                  <div class="field-hint">Driver options (key/value)</div>
                  <div id="opts"></div>
                  <button type="button" id="add-opt" class="ghost" style="align-self:flex-start">+ Add option</button>
                </div>
              </details>
            </section>

            <div class="actions">
              <button type="button" id="test" class="ghost">Test Connection</button>
              <div class="spacer"></div>
              <button type="button" id="cancel" class="ghost">Cancel</button>
              <button type="submit" id="save" class="primary">Save</button>
            </div>
            <div id="status"></div>
          </form>
        </div>
        <script nonce="${nonce}" src="${src}"></script>
      </body></html>`;
  }
}
