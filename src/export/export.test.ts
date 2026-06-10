import { describe, it, expect } from "vitest";
import { toCsv } from "./csv";
import { toJson } from "./json";
import type { ResultSet } from "../drivers/types";

const rs: ResultSet = {
  columns: [
    { name: "id", type: "int4" },
    { name: "name", type: "text" },
  ],
  rows: [
    [1, "Ada"],
    [2, "Grace, the"],
  ],
  page: 0,
  pageSize: 2,
};

describe("toCsv", () => {
  it("emits a header row and quotes values containing commas", () => {
    const csv = toCsv(rs);
    expect(csv).toBe('id,name\n1,Ada\n2,"Grace, the"\n');
  });
});

describe("toJson", () => {
  it("emits an array of column-keyed objects", () => {
    expect(JSON.parse(toJson(rs))).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace, the" },
    ]);
  });
});
