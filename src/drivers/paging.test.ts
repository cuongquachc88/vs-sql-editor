import { describe, it, expect } from "vitest";
import { applySelectPaging } from "./paging";

describe("applySelectPaging", () => {
  it("wraps a SELECT with LIMIT/OFFSET", () => {
    expect(applySelectPaging("select * from t", 0, 10)).toBe(
      "select * from (select * from t) as _q limit 10 offset 0",
    );
  });
  it("computes offset from the page number", () => {
    expect(applySelectPaging("select 1", 2, 25)).toBe(
      "select * from (select 1) as _q limit 25 offset 50",
    );
  });
  it("wraps a CTE (WITH ...)", () => {
    expect(applySelectPaging("with x as (select 1) select * from x", 0, 5)).toContain("limit 5");
  });
  it("passes non-SELECT statements through untouched", () => {
    expect(applySelectPaging("update t set a = 1", 0, 10)).toBe("update t set a = 1");
  });
  it("honors a custom alias", () => {
    expect(applySelectPaging("select 1", 0, 10, "sub")).toContain("as sub");
  });
});
