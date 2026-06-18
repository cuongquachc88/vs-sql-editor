import * as vscode from "vscode";
import type { ConnectionStore } from "../connections/store";
import type { SchemaCache } from "../connections/schema-cache";
import { getActiveProvider } from "./factory";
import { buildFixPrompt, pickRelevantDigest } from "./prompts";
import { AiUnavailableError } from "./provider";

// Tracks the last error so the "Suggest fix" command knows what to fix.
export interface LastErrorEntry {
  sql: string;
  errorMessage: string;
  at: number;
}

let lastError: LastErrorEntry | undefined;

export function recordLastError(sql: string, errorMessage: string): void {
  lastError = { sql, errorMessage, at: Date.now() };
}

export function getLastError(): LastErrorEntry | undefined {
  return lastError;
}

export async function aiSuggestFix(
  context: vscode.ExtensionContext,
  store: ConnectionStore,
  schemaCache: SchemaCache,
  activeProfileId: string | undefined,
): Promise<void> {
  if (!lastError) {
    void vscode.window.showInformationMessage(
      "No recent failing query to fix. Run a query first.",
    );
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
  const digest = pickRelevantDigest(model, lastError.sql);
  const { system, user } = buildFixPrompt({
    engine,
    schemaDigest: digest,
    sql: lastError.sql,
    errorMessage: lastError.errorMessage,
  });
  const provider = await getActiveProvider(context.secrets);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "AI: drafting fix…" },
    async () => {
      try {
        const fixed = await provider.chat([
          { role: "system", content: system },
          { role: "user", content: user },
        ]);
        const cleaned = stripCodeFences(fixed).trim();
        const doc = await vscode.workspace.openTextDocument({
          language: "sql",
          content: `-- AI-suggested fix for the failing query:\n${cleaned}\n`,
        });
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
      } catch (err) {
        const msg =
          err instanceof AiUnavailableError
            ? err.message
            : `AI request failed: ${(err as Error).message}`;
        void vscode.window.showErrorMessage(msg);
      }
    },
  );
}

function stripCodeFences(s: string): string {
  return s.replace(/^```[a-zA-Z]*\n?/g, "").replace(/```$/g, "");
}
