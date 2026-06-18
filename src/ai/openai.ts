import { AiUnavailableError, type AiProvider, type ChatMessage, type ChatOptions } from "./provider";

export interface OpenAiConfig {
  baseUrl: string;
  model: string;
  apiKey: string | undefined;
  // For tests: inject a fetch implementation.
  fetchImpl?: typeof fetch;
}

// OpenAI-compatible HTTP client. Works against api.openai.com, Together,
// LM Studio, Ollama (with the openai compat endpoint), etc.
export class OpenAiProvider implements AiProvider {
  readonly id = "openai" as const;

  constructor(private readonly cfg: OpenAiConfig) {}

  available(): Promise<boolean> {
    return Promise.resolve(Boolean(this.cfg.apiKey));
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    if (!this.cfg.apiKey) {
      throw new AiUnavailableError(
        "OpenAI API key is not set. Run \"SQL: Set OpenAI API Key\".",
      );
    }
    const fetchFn = this.cfg.fetchImpl ?? fetch;
    const url = `${this.cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const body = {
      model: this.cfg.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: Boolean(opts.onChunk),
      temperature: opts.temperature ?? 0.2,
    };
    const res = await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAI request failed (${res.status}): ${text || res.statusText}`);
    }
    if (!body.stream) {
      const json = (await res.json()) as { choices: { message: { content: string } }[] };
      return json.choices[0]?.message.content ?? "";
    }
    return await readSseStream(res, opts.onChunk);
  }
}

async function readSseStream(
  res: Response,
  onChunk: ((s: string) => void) | undefined,
): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let out = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return out;
      try {
        const json = JSON.parse(data) as {
          choices?: { delta?: { content?: string } }[];
        };
        const piece = json.choices?.[0]?.delta?.content;
        if (piece) {
          out += piece;
          onChunk?.(piece);
        }
      } catch {
        // ignore malformed SSE lines
      }
    }
  }
  return out;
}
