import { describe, it, expect } from "vitest";
import { isWebviewMessage } from "./protocol";

describe("welcome isWebviewMessage", () => {
  it("accepts simple messages", () => {
    expect(isWebviewMessage({ type: "ready" })).toBe(true);
    expect(isWebviewMessage({ type: "addConnection" })).toBe(true);
    expect(isWebviewMessage({ type: "clearRecents" })).toBe(true);
  });
  it("accepts openConnection / openSample / openQuery with required fields", () => {
    expect(isWebviewMessage({ type: "openConnection", profileId: "p" })).toBe(true);
    expect(isWebviewMessage({ type: "openSample", engine: "postgres" })).toBe(true);
    expect(isWebviewMessage({ type: "openQuery", sql: "select 1" })).toBe(true);
  });
  it("rejects malformed", () => {
    expect(isWebviewMessage(null)).toBe(false);
    expect(isWebviewMessage({ type: "openConnection" })).toBe(false);
    expect(isWebviewMessage({ type: "nope" })).toBe(false);
  });
});
