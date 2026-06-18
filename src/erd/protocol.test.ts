import { describe, it, expect } from "vitest";
import { isWebviewMessage } from "./protocol";

describe("erd isWebviewMessage", () => {
  it("accepts ready / resetLayout", () => {
    expect(isWebviewMessage({ type: "ready" })).toBe(true);
    expect(isWebviewMessage({ type: "resetLayout" })).toBe(true);
  });
  it("accepts saveLayout", () => {
    expect(isWebviewMessage({ type: "saveLayout", layout: {} })).toBe(true);
  });
  it("accepts openTable", () => {
    expect(
      isWebviewMessage({
        type: "openTable",
        database: "d",
        schema: "s",
        table: "t",
        isView: false,
      }),
    ).toBe(true);
    expect(isWebviewMessage({ type: "openTable", database: "d" })).toBe(false);
  });
  it("rejects junk", () => {
    expect(isWebviewMessage(null)).toBe(false);
    expect(isWebviewMessage({ type: "nope" })).toBe(false);
  });
});
