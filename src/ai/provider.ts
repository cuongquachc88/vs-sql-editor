export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatOptions {
  signal?: AbortSignal;
  onChunk?: (text: string) => void;
  temperature?: number;
}

export interface AiProvider {
  readonly id: "vscode-lm" | "openai";
  available(): Promise<boolean>;
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string>;
}

export class AiUnavailableError extends Error {
  constructor(message = "No AI provider is available.") {
    super(message);
    this.name = "AiUnavailableError";
  }
}
