import * as vscode from "vscode";
import { isWebviewMessage, type HostMessage, type WebviewMessage } from "./protocol";

export class ResultsPanel {
  private static current: ResultsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private onMessage?: (m: WebviewMessage) => void;

  static show(context: vscode.ExtensionContext): ResultsPanel {
    if (ResultsPanel.current) {
      ResultsPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      return ResultsPanel.current;
    }
    ResultsPanel.current = new ResultsPanel(context);
    return ResultsPanel.current;
  }

  private constructor(context: vscode.ExtensionContext) {
    this.panel = vscode.window.createWebviewPanel(
      "vsSqlEditor.results",
      "SQL Results",
      vscode.ViewColumn.Beside,
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
        body { font-family: var(--vscode-font-family); margin: 0; padding: 8px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid var(--vscode-panel-border); padding: 2px 6px; text-align: left; }
        th { position: sticky; top: 0; background: var(--vscode-editor-background); }
        #bar { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
        .err { color: var(--vscode-errorForeground); white-space: pre-wrap; }
        button { cursor: pointer; }
      </style></head>
      <body>
        <div id="bar">
          <button id="prev">◀ Prev</button><span id="page"></span><button id="next">Next ▶</button>
          <span style="flex:1"></span>
          <button id="csv">Export CSV</button><button id="json">Export JSON</button>
        </div>
        <div id="content"></div>
        <script nonce="${nonce}" src="${src}"></script>
      </body></html>`;
  }
}
