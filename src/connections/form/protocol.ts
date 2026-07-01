import type { EngineId, SslMode } from "../../drivers/types";

export type FormMode = "add" | "edit" | "duplicate";

// Profile shape exchanged with the webview. No id, no secret — those live on the host.
export interface FormProfile {
  name: string;
  engine: EngineId;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  filePath?: string;
  sslMode?: SslMode;
  sslCa?: string;
  options?: Record<string, string>;
}

// Host -> Webview
export type HostMessage =
  | {
      type: "init";
      mode: FormMode;
      profile?: FormProfile;
      hasExistingSecret?: boolean;
    }
  | { type: "testResult"; ok: boolean; error?: string }
  | { type: "filePicked"; path: string }
  | { type: "saveError"; message: string };

// Webview -> Host
export type WebviewMessage =
  | { type: "ready" }
  | { type: "test"; profile: FormProfile; secret?: string }
  | {
      type: "save";
      profile: FormProfile;
      secret?: string;
      // For edit mode: explicitly clear the stored secret.
      clearSecret?: boolean;
    }
  | { type: "pickFile"; engine: "sqlite" | "pglite" }
  | { type: "cancel" };

export function isWebviewMessage(m: unknown): m is WebviewMessage {
  if (!m || typeof m !== "object") return false;
  const t = (m as { type?: unknown }).type;
  if (t === "ready" || t === "cancel") return true;
  if (t === "pickFile") {
    const e = (m as { engine?: unknown }).engine;
    return e === "sqlite" || e === "pglite";
  }
  if (t === "test" || t === "save") {
    const p = (m as { profile?: unknown }).profile;
    return !!p && typeof p === "object" && typeof (p as { engine?: unknown }).engine === "string";
  }
  return false;
}
