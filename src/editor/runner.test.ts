import { describe, it, expect } from "vitest";
import { resolveSql } from "./runner";

describe("resolveSql", () => {
  it("uses the selection when one exists", () => {
    expect(resolveSql("select 1;\nselect 2;", "select 2")).toBe("select 2");
  });
  it("falls back to the whole document when selection is empty", () => {
    expect(resolveSql("select 1;", "")).toBe("select 1;");
  });
});
