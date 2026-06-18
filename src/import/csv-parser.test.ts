import { describe, it, expect } from "vitest";
import { parseCsv } from "./csv-parser";

describe("parseCsv", () => {
  it("parses a simple table", () => {
    expect(parseCsv("a,b,c\n1,2,3\n4,5,6")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
  });

  it("handles quoted fields with embedded commas", () => {
    expect(parseCsv('a,b\n"x,y",z')).toEqual([
      ["a", "b"],
      ["x,y", "z"],
    ]);
  });

  it("handles escaped double-quotes inside quoted fields", () => {
    expect(parseCsv('a\n"she said ""hi"""')).toEqual([["a"], [`she said "hi"`]]);
  });

  it("handles embedded newlines inside quoted fields", () => {
    expect(parseCsv('a,b\n"line1\nline2",2')).toEqual([
      ["a", "b"],
      ["line1\nline2", "2"],
    ]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n3,4\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("ignores a trailing newline", () => {
    expect(parseCsv("a\n1\n")).toEqual([["a"], ["1"]]);
  });

  it("strips a leading BOM", () => {
    expect(parseCsv("﻿a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("supports a tab delimiter", () => {
    expect(parseCsv("a\tb\n1\t2", { delimiter: "\t" })).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("preserves empty fields", () => {
    expect(parseCsv("a,b,c\n,,3\n1,,")).toEqual([
      ["a", "b", "c"],
      ["", "", "3"],
      ["1", "", ""],
    ]);
  });
});
