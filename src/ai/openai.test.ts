import { describe, it, expect, vi } from "vitest";
import { OpenAiProvider } from "./openai";

describe("OpenAiProvider", () => {
  it("reports unavailable without an API key", async () => {
    const p = new OpenAiProvider({
      baseUrl: "https://api",
      model: "x",
      apiKey: undefined,
    });
    expect(await p.available()).toBe(false);
  });

  it("throws AiUnavailableError on chat when key is missing", async () => {
    const p = new OpenAiProvider({ baseUrl: "https://api", model: "x", apiKey: undefined });
    await expect(
      p.chat([{ role: "user", content: "hi" }]),
    ).rejects.toMatchObject({ name: "AiUnavailableError" });
  });

  it("returns the assistant message on a non-streamed response", async () => {
    const fakeFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        choices: [{ message: { content: "select 1" } }],
      }),
    }));
    const p = new OpenAiProvider({
      baseUrl: "https://api",
      model: "x",
      apiKey: "k",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });
    const out = await p.chat([{ role: "user", content: "hi" }]);
    expect(out).toBe("select 1");
    expect(fakeFetch).toHaveBeenCalledOnce();
    const call = fakeFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://api/chat/completions");
    expect((call[1].headers as Record<string, string>).Authorization).toBe("Bearer k");
  });

  it("includes the error body in the thrown message", async () => {
    const fakeFetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "bad key",
    }));
    const p = new OpenAiProvider({
      baseUrl: "https://api/",
      model: "x",
      apiKey: "k",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });
    await expect(p.chat([{ role: "user", content: "x" }])).rejects.toThrow(/401.*bad key/);
  });

  it("streams SSE chunks via onChunk and returns the concatenated text", async () => {
    const encoder = new TextEncoder();
    const lines = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "se" } }] })}\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "lect" } }] })}\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: " 1" } }] })}\n`,
      "data: [DONE]\n",
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const l of lines) controller.enqueue(encoder.encode(l));
        controller.close();
      },
    });
    const fakeFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      body,
    }));
    const p = new OpenAiProvider({
      baseUrl: "https://api",
      model: "x",
      apiKey: "k",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });
    const chunks: string[] = [];
    const result = await p.chat([{ role: "user", content: "hi" }], {
      onChunk: (s) => chunks.push(s),
    });
    expect(chunks).toEqual(["se", "lect", " 1"]);
    expect(result).toBe("select 1");
  });
});
