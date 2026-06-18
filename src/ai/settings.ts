import * as vscode from "vscode";

export type ProviderPref = "auto" | "vscode-lm" | "openai";

export interface AiSettings {
  provider: ProviderPref;
  openaiBaseUrl: string;
  openaiModel: string;
  inlineEnabled: boolean;
}

const SECRET_KEY = "vsSqlEditor.openaiApiKey";

export function readAiSettings(): AiSettings {
  const cfg = vscode.workspace.getConfiguration("vsSqlEditor");
  return {
    provider: cfg.get<ProviderPref>("ai.provider", "auto"),
    openaiBaseUrl: cfg.get<string>("ai.openai.baseUrl", "https://api.openai.com/v1"),
    openaiModel: cfg.get<string>("ai.openai.model", "gpt-4o-mini"),
    inlineEnabled: cfg.get<boolean>("ai.inline.enabled", true),
  };
}

export async function getOpenAiKey(secrets: vscode.SecretStorage): Promise<string | undefined> {
  return secrets.get(SECRET_KEY);
}

export async function setOpenAiKey(secrets: vscode.SecretStorage, key: string): Promise<void> {
  await secrets.store(SECRET_KEY, key);
}

export async function clearOpenAiKey(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(SECRET_KEY);
}
