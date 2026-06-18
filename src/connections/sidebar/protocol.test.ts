import { describe, it, expect } from "vitest";
import { isWebviewMessage } from "./protocol";

describe("sidebar isWebviewMessage", () => {
  it("accepts no-arg messages", () => {
    expect(isWebviewMessage({ type: "ready" })).toBe(true);
    expect(isWebviewMessage({ type: "addConnection" })).toBe(true);
    expect(isWebviewMessage({ type: "refresh" })).toBe(true);
  });

  it("accepts id-bearing messages", () => {
    expect(isWebviewMessage({ type: "setActive", profileId: "p" })).toBe(true);
    expect(isWebviewMessage({ type: "edit", profileId: "p" })).toBe(true);
    expect(isWebviewMessage({ type: "duplicate", profileId: "p" })).toBe(true);
    expect(isWebviewMessage({ type: "delete", profileId: "p" })).toBe(true);
    expect(isWebviewMessage({ type: "loadSchema", profileId: "p" })).toBe(true);
    expect(isWebviewMessage({ type: "setActive" })).toBe(false);
  });

  it("accepts previewTable when all fields are present", () => {
    expect(
      isWebviewMessage({
        type: "previewTable",
        profileId: "p",
        database: "d",
        schema: "s",
        table: "t",
        isView: false,
      }),
    ).toBe(true);
    expect(
      isWebviewMessage({
        type: "previewTable",
        profileId: "p",
        database: "d",
        schema: "s",
        table: "t",
      }),
    ).toBe(false);
  });

  it("rejects junk", () => {
    expect(isWebviewMessage(null)).toBe(false);
    expect(isWebviewMessage({ type: "nope" })).toBe(false);
  });
});
