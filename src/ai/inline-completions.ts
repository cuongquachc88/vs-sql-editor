import * as vscode from "vscode";
import type { ConnectionStore } from "../connections/store";
import type { SchemaCache } from "../connections/schema-cache";
import { getActiveProvider } from "./factory";
import { buildCompletionPrompt, pickRelevantDigest } from "./prompts";
import { readAiSettings } from "./settings";

const DEBOUNCE_MS = 300;
const MAX_CONTEXT_CHARS = 4000;

export function createInlineCompletionProvider(
  context: vscode.ExtensionContext,
  store: ConnectionStore,
  schemaCache: SchemaCache,
  getActiveProfileId: () => string | undefined,
): vscode.InlineCompletionItemProvider {
  // Single shared abort controller — a fresh keystroke cancels the in-flight call.
  let inflight: AbortController | undefined;
  let lastKeystrokeAt = 0;

  return {
    async provideInlineCompletionItems(document, position, _ctx, token) {
      void _ctx;
      if (document.languageId !== "sql") return null;
      if (!readAiSettings().inlineEnabled) return null;
      lastKeystrokeAt = Date.now();
      await sleep(DEBOUNCE_MS);
      // If another keystroke landed during the debounce, abort.
      if (Date.now() - lastKeystrokeAt < DEBOUNCE_MS) return null;
      if (token.isCancellationRequested) return null;

      const profileId = getActiveProfileId();
      const profile = profileId ? store.get(profileId) : undefined;
      const engine = profile?.engine ?? "postgres";
      let model;
      try {
        if (profileId) model = await schemaCache.get(profileId);
      } catch {
        model = undefined;
      }
      const before = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
      const trimmed = before.length > MAX_CONTEXT_CHARS ? before.slice(-MAX_CONTEXT_CHARS) : before;
      const { system, user } = buildCompletionPrompt({
        engine,
        schemaDigest: pickRelevantDigest(model, before),
        contextBefore: trimmed,
      });

      inflight?.abort();
      inflight = new AbortController();
      const signal = inflight.signal;
      token.onCancellationRequested(() => inflight?.abort());

      try {
        const provider = await getActiveProvider(context.secrets);
        const raw = await provider.chat(
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          { signal },
        );
        const cleaned = trimCompletion(raw);
        if (!cleaned) return null;
        return [
          new vscode.InlineCompletionItem(
            cleaned,
            new vscode.Range(position, position),
          ),
        ];
      } catch {
        return null;
      }
    },
  };
}

export function trimCompletion(raw: string): string {
  // Strip leading/trailing fences and excessive whitespace; keep at most ~3 lines.
  const stripped = raw.replace(/^```[a-zA-Z]*\n?/g, "").replace(/```$/g, "").trimEnd();
  const lines = stripped.split(/\r?\n/);
  return lines.slice(0, 3).join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
