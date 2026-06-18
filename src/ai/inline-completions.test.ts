import { describe, it, expect } from "vitest";
import { trimCompletion } from "./inline-completions";

describe("trimCompletion", () => {
  it("strips leading and trailing code fences", () => {
    expect(trimCompletion("```sql\nselect 1;\n```")).toBe("select 1;");
    expect(trimCompletion("```\nselect 1;\n```")).toBe("select 1;");
  });
  it("caps at 3 lines", () => {
    const raw = "a\nb\nc\nd\ne";
    expect(trimCompletion(raw)).toBe("a\nb\nc");
  });
  it("trims trailing whitespace but preserves internal layout", () => {
    expect(trimCompletion("select 1\n  from t   \n")).toBe("select 1\n  from t");
  });
  it("handles an empty response gracefully", () => {
    expect(trimCompletion("")).toBe("");
    expect(trimCompletion("\n\n")).toBe("");
  });
});
