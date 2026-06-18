import * as vscode from "vscode";
import { getDesignTokensCss } from "../ui/styles";
import type { ConnectionStore } from "../connections/store";
import type { SchemaCache } from "../connections/schema-cache";
import { getActiveProvider } from "./factory";
import { buildExplainPrompt, pickRelevantDigest } from "./prompts";
import { AiUnavailableError } from "./provider";

class ExplainPanel {
  private static current: ExplainPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  static show(context: vscode.ExtensionContext): ExplainPanel {
    if (ExplainPanel.current) {
      ExplainPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      return ExplainPanel.current;
    }
    ExplainPanel.current = new ExplainPanel(context);
    return ExplainPanel.current;
  }

  private constructor(context: vscode.ExtensionContext) {
    this.panel = vscode.window.createWebviewPanel(
      "vsSqlEditor.aiExplain",
      "AI: Explain SQL",
      vscode.ViewColumn.Beside,
      { enableScripts: false, retainContextWhenHidden: true },
    );
    this.panel.webview.html = this.html();
    this.panel.onDidDispose(() => {
      ExplainPanel.current = undefined;
    });
  }

  setBody(text: string, sql: string): void {
    this.panel.webview.html = this.html(text, sql);
  }

  private html(body = "Thinking…", sql = ""): string {
    return `<!DOCTYPE html><html><head>
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
      <style>
${getDesignTokensCss()}
body {
  padding: var(--vsx-gap-lg) var(--vsx-gap-xl);
  display: flex;
  flex-direction: column;
  gap: var(--vsx-gap-md);
  max-width: 720px;
}
pre.sql {
  font-family: var(--vscode-editor-font-family);
  font-size: 12px;
  padding: var(--vsx-gap);
  background: var(--vsx-surface);
  border: 1px solid var(--vsx-border);
  border-radius: var(--vsx-radius);
  white-space: pre-wrap;
  word-break: break-word;
}
.explanation {
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
}
.section-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vscode-descriptionForeground);
  font-weight: 600;
  margin-top: var(--vsx-gap);
}
      </style></head>
      <body>
        ${sql ? `<div class="section-label">Query</div><pre class="sql">${escapeHtml(sql)}</pre>` : ""}
        <div class="section-label">Explanation</div>
        <div class="explanation">${escapeHtml(body)}</div>
      </body></html>`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export async function aiExplain(
  context: vscode.ExtensionContext,
  store: ConnectionStore,
  schemaCache: SchemaCache,
  activeProfileId: string | undefined,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage("Open a .sql file first.");
    return;
  }
  const selection = editor.document.getText(editor.selection).trim();
  const fullDoc = editor.document.getText().trim();
  const sql = selection || fullDoc;
  if (!sql) {
    void vscode.window.showInformationMessage("Nothing to explain.");
    return;
  }
  const profile = activeProfileId ? store.get(activeProfileId) : undefined;
  const engine = profile?.engine ?? "postgres";
  let model;
  try {
    if (activeProfileId) model = await schemaCache.get(activeProfileId);
  } catch {
    model = undefined;
  }
  const digest = pickRelevantDigest(model, sql);
  const { system, user } = buildExplainPrompt({ engine, schemaDigest: digest, sql });
  const provider = await getActiveProvider(context.secrets);

  const panel = ExplainPanel.show(context);
  let buffer = "";
  panel.setBody("Thinking…", sql);
  try {
    await provider.chat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      {
        onChunk: (chunk) => {
          buffer += chunk;
          panel.setBody(buffer, sql);
        },
      },
    );
    if (!buffer) panel.setBody("(No response.)", sql);
  } catch (err) {
    const msg =
      err instanceof AiUnavailableError
        ? err.message
        : `AI request failed: ${(err as Error).message}`;
    panel.setBody(msg, sql);
  }
}
