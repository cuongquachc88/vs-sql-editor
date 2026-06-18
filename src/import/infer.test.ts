import { describe, it, expect } from "vitest";
import { inferTypes } from "./infer";

describe("inferTypes", () => {
  it("returns [] when there are no rows", () => {
    expect(inferTypes([])).toEqual([]);
  });

  it("infers integer/real/text per column", () => {
    expect(
      inferTypes([
        ["1", "1.5", "a"],
        ["2", "2.5", "b"],
        ["3", "3.0", "c"],
      ]),
    ).toEqual(["integer", "real", "text"]);
  });

  it("widens integer to real when a real value appears", () => {
    expect(inferTypes([["1"], ["2.5"], ["3"]])).toEqual(["real"]);
  });

  it("falls back to text when a column mixes booleans and numbers", () => {
    expect(inferTypes([["1"], ["true"], ["2"]])).toEqual(["text"]);
  });

  it("infers boolean when all non-empty values look boolean", () => {
    expect(inferTypes([["true"], ["false"], [""], ["t"]])).toEqual(["boolean"]);
  });

  it("treats empty strings as null and doesn't constrain the type", () => {
    expect(inferTypes([["", "1"], ["", "2"], ["", "3"]])).toEqual(["text", "integer"]);
  });

  it("respects sampleSize", () => {
    const rows = [
      ["1"],
      ["2"],
      ["3"],
      ["not-a-number"],
    ];
    expect(inferTypes(rows, { sampleSize: 3 })).toEqual(["integer"]);
    expect(inferTypes(rows, { sampleSize: 4 })).toEqual(["text"]);
  });
});
