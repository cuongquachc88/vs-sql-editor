import { describe, it, expect } from "vitest";
import { isWebviewMessage } from "./protocol";

describe("import isWebviewMessage", () => {
  it("accepts simple messages", () => {
    expect(isWebviewMessage({ type: "ready" })).toBe(true);
    expect(isWebviewMessage({ type: "pickFile" })).toBe(true);
    expect(isWebviewMessage({ type: "cancel" })).toBe(true);
  });
  it("accepts runImport with required fields", () => {
    expect(
      isWebviewMessage({
        type: "runImport",
        filePath: "/tmp/x.csv",
        targetTable: "x",
        columns: [],
      }),
    ).toBe(true);
    expect(isWebviewMessage({ type: "runImport", filePath: "/x" })).toBe(false);
  });
  it("rejects junk", () => {
    expect(isWebviewMessage(null)).toBe(false);
    expect(isWebviewMessage({ type: "nope" })).toBe(false);
  });
});
