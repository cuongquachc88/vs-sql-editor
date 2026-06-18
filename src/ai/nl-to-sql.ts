import * as vscode from "vscode";
import type { ConnectionStore } from "../connections/store";
import type { SchemaCache } from "../connections/schema-cache";
import { getActiveProvider } from "./factory";
import { buildNlToSqlPrompt, pickRelevantDigest } from "./prompts";
import { AiUnavailableError } from "./provider";

export async function aiAskSql(
  context: vscode.ExtensionContext,
  store: ConnectionStore,
  schemaCache: SchemaCache,
  activeProfileId: string | undefined,
): Promise<void> {
  if (!activeProfileId) {
    void vscode.window.showInformationMessage(
      "Pick an active SQL connection first (sidebar → SQL Editor).",
    );
    return;
  }
  const profile = store.get(activeProfileId);
  if (!profile) return;

  const question = await vscode.window.showInputBox({
    prompt: `Ask in plain English (engine: ${profile.engine})`,
    placeHolder: "e.g. users who signed up in the last 7 days",
  });
  if (!question) return;

  let editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "sql") {
    const doc = await vscode.workspace.openTextDocument({ language: "sql", content: "" });
    editor = await vscode.window.showTextDocument(doc);
  }

  let model;
  try {
    model = await schemaCache.get(activeProfileId);
  } catch {
    // Schema may be unavailable (offline) — still let the user ask, just with
    // a smaller digest.
    model = undefined;
  }
  const digest = pickRelevantDigest(model, question);
  const { system, user } = buildNlToSqlPrompt({
    engine: profile.engine,
    schemaDigest: digest,
    question,
  });

  const provider = await getActiveProvider(context.secrets);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "AI: generating SQL…" },
    async () => {
      try {
        // Insert at cursor (replace selection if any).
        const selection = editor!.selection;
        const startInsertPos = selection.isEmpty ? selection.active : selection.start;
        if (!selection.isEmpty) {
          await editor!.edit((eb) => eb.replace(selection, ""));
        }
        let buffer = "";
        let cursor = startInsertPos;
        const flush = async () => {
          if (!buffer) return;
          const chunk = buffer;
          buffer = "";
          await editor!.edit(
            (eb) => eb.insert(cursor, chunk),
            { undoStopBefore: false, undoStopAfter: false },
          );
          // Move cursor forward by the chunk length.
          for (const ch of chunk) {
            cursor =
              ch === "\n"
                ? new vscode.Position(cursor.line + 1, 0)
                : cursor.with(cursor.line, cursor.character + 1);
          }
          editor!.selection = new vscode.Selection(cursor, cursor);
        };

        await provider.chat(
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          {
            onChunk: (chunk) => {
              buffer += chunk;
              void flush();
            },
          },
        );
        await flush();
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
