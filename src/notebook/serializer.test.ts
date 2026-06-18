import { describe, it, expect } from "vitest";
import { SqlNotebookSerializer } from "./serializer";

const enc = (s: string) => Buffer.from(s, "utf-8");

describe("SqlNotebookSerializer", () => {
  const ser = new SqlNotebookSerializer();
  const token = {} as never;

  it("returns a default cell for an empty file", async () => {
    const data = await ser.deserializeNotebook(enc(""), token);
    expect(data.cells).toHaveLength(1);
    expect(data.cells[0].languageId).toBe("sql");
    expect(data.cells[0].value).toContain("select 1 as hello");
  });

  it("treats free-form text as a single SQL cell", async () => {
    const data = await ser.deserializeNotebook(enc("select 42"), token);
    expect(data.cells).toHaveLength(1);
    expect(data.cells[0].value).toBe("select 42");
  });

  it("round-trips JSON cells", async () => {
    const raw = JSON.stringify({
      cells: [
        { kind: "code", language: "sql", value: "select 1;" },
        { kind: "markdown", language: "markdown", value: "# notes" },
        { kind: "code", language: "sql", value: "select 2;" },
      ],
    });
    const data = await ser.deserializeNotebook(enc(raw), token);
    expect(data.cells.map((c) => c.value)).toEqual(["select 1;", "# notes", "select 2;"]);
    const out = await ser.serializeNotebook(data, token);
    const parsed = JSON.parse(Buffer.from(out).toString("utf-8")) as { cells: { value: string }[] };
    expect(parsed.cells.map((c) => c.value)).toEqual(["select 1;", "# notes", "select 2;"]);
  });
});
