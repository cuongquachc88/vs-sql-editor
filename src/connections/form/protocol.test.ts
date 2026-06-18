import { describe, it, expect } from "vitest";
import { isWebviewMessage } from "./protocol";

describe("isWebviewMessage", () => {
  it("accepts ready / cancel", () => {
    expect(isWebviewMessage({ type: "ready" })).toBe(true);
    expect(isWebviewMessage({ type: "cancel" })).toBe(true);
  });

  it("accepts pickFile for sqlite / pglite", () => {
    expect(isWebviewMessage({ type: "pickFile", engine: "sqlite" })).toBe(true);
    expect(isWebviewMessage({ type: "pickFile", engine: "pglite" })).toBe(true);
    expect(isWebviewMessage({ type: "pickFile", engine: "postgres" })).toBe(false);
  });

  it("accepts test/save when a profile with an engine is present", () => {
    expect(
      isWebviewMessage({ type: "test", profile: { name: "x", engine: "postgres" }, secret: "p" }),
    ).toBe(true);
    expect(
      isWebviewMessage({ type: "save", profile: { name: "x", engine: "sqlite", filePath: "/a" } }),
    ).toBe(true);
  });

  it("rejects malformed messages", () => {
    expect(isWebviewMessage(null)).toBe(false);
    expect(isWebviewMessage({})).toBe(false);
    expect(isWebviewMessage({ type: "test" })).toBe(false);
    expect(isWebviewMessage({ type: "save", profile: {} })).toBe(false);
    expect(isWebviewMessage({ type: "nope" })).toBe(false);
  });
});
