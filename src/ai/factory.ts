import * as vscode from "vscode";
import type { AiProvider } from "./provider";
import { OpenAiProvider } from "./openai";
import { VscodeLmProvider } from "./vscode-lm";
import { getOpenAiKey, readAiSettings } from "./settings";

// Picks the active provider based on settings + availability.
//
//   "vscode-lm" → always returns the vscode.lm wrapper (caller may then handle
//                 the unavailability error).
//   "openai"    → always returns the OpenAI client (caller may handle missing key).
//   "auto"      → prefer vscode.lm; fall back to OpenAI when no LM is registered
//                 and a key is configured.
export async function getActiveProvider(secrets: vscode.SecretStorage): Promise<AiProvider> {
  const s = readAiSettings();
  const key = await getOpenAiKey(secrets);
  const openai = new OpenAiProvider({
    baseUrl: s.openaiBaseUrl,
    model: s.openaiModel,
    apiKey: key,
  });
  if (s.provider === "openai") return openai;
  const lm = new VscodeLmProvider();
  if (s.provider === "vscode-lm") return lm;
  // auto: prefer vscode-lm if available, else openai
  if (await lm.available()) return lm;
  return openai;
}
