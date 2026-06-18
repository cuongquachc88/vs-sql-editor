import * as vscode from "vscode";
import { AiUnavailableError, type AiProvider, type ChatMessage, type ChatOptions } from "./provider";

// Wraps vscode.lm (the host-supplied Language Model API — Copilot etc.).
// Falls back to AiUnavailableError when no chat model is selectable.
export class VscodeLmProvider implements AiProvider {
  readonly id = "vscode-lm" as const;

  async available(): Promise<boolean> {
    try {
      const lm = (vscode as unknown as { lm?: { selectChatModels: (sel?: unknown) => Promise<unknown[]> } }).lm;
      if (!lm) return false;
      const models = await lm.selectChatModels();
      return Array.isArray(models) && models.length > 0;
    } catch {
      return false;
    }
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const lm = (vscode as unknown as {
      lm?: {
        selectChatModels: (sel?: unknown) => Promise<unknown[]>;
        LanguageModelChatMessage?: { User: (s: string) => unknown; Assistant: (s: string) => unknown };
      };
    }).lm;
    if (!lm) throw new AiUnavailableError("VS Code Language Model API is not available.");
    const models = await lm.selectChatModels();
    if (!Array.isArray(models) || models.length === 0) {
      throw new AiUnavailableError("No language models are available.");
    }
    // The API offers a static helper, but we keep it duck-typed to avoid hard
    // failures on older vscode @types.
    const factory =
      lm.LanguageModelChatMessage ??
      ({
        User: (s: string) => ({ role: "user", content: s }),
        Assistant: (s: string) => ({ role: "assistant", content: s }),
      } as { User: (s: string) => unknown; Assistant: (s: string) => unknown });
    const mapped = messages.map((m) =>
      m.role === "assistant" ? factory.Assistant(m.content) : factory.User(m.content),
    );
    const model = models[0] as {
      sendRequest: (
        msgs: unknown[],
        options?: unknown,
        token?: vscode.CancellationToken,
      ) => Promise<{ text: AsyncIterable<string> }>;
    };
    // Bridge AbortSignal -> CancellationToken.
    const tokenSource = new vscode.CancellationTokenSource();
    const sub = opts.signal?.addEventListener("abort", () => tokenSource.cancel());
    try {
      const response = await model.sendRequest(mapped, {}, tokenSource.token);
      let out = "";
      for await (const chunk of response.text) {
        out += chunk;
        opts.onChunk?.(chunk);
      }
      return out;
    } finally {
      void sub;
      tokenSource.dispose();
    }
  }
}
