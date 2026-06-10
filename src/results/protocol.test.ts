import { describe, it, expect } from "vitest";
import { isWebviewMessage } from "./protocol";

describe("isWebviewMessage", () => {
  it("accepts a requestPage message", () => {
    expect(isWebviewMessage({ type: "requestPage", page: 2 })).toBe(true);
  });
  it("accepts an export message", () => {
    expect(isWebviewMessage({ type: "export", format: "csv" })).toBe(true);
  });
  it("accepts an applyEdit message", () => {
    expect(isWebviewMessage({ type: "applyEdit", pk: { id: 1 }, column: "name", value: "x" })).toBe(
      true,
    );
  });

  it("rejects junk", () => {
    expect(isWebviewMessage({ type: "nope" })).toBe(false);
    expect(isWebviewMessage(null)).toBe(false);
    expect(isWebviewMessage({ type: "applyEdit", column: "name" })).toBe(false);
  });
});
