import { describe, it, expect } from "vitest";
import { buildUpdate, formatLiteral, quoteDoubleQuote, quoteBacktick } from "./sql";

describe("formatLiteral", () => {
  it("formats numbers, booleans, null, and escapes strings", () => {
    expect(formatLiteral(42)).toBe("42");
    expect(formatLiteral(true)).toBe("TRUE");
    expect(formatLiteral(null)).toBe("NULL");
    expect(formatLiteral(undefined)).toBe("NULL");
    expect(formatLiteral("O'Brien")).toBe("'O''Brien'");
  });
});

describe("buildUpdate", () => {
  it("builds a quoted UPDATE for double-quote engines", () => {
    const sql = buildUpdate(quoteDoubleQuote, '"public"."users"', { id: 7 }, { name: "Ada" });
    expect(sql).toBe(`update "public"."users" set "name" = 'Ada' where "id" = 7`);
  });

  it("builds a backtick UPDATE for MySQL", () => {
    const sql = buildUpdate(quoteBacktick, "`app`.`users`", { id: 7 }, { email: "a@b.co" });
    expect(sql).toBe("update `app`.`users` set `email` = 'a@b.co' where `id` = 7");
  });

  it("supports composite primary keys and multiple changes", () => {
    const sql = buildUpdate(
      quoteDoubleQuote,
      '"t"',
      { a: 1, b: 2 },
      { x: "p", y: 3 },
    );
    expect(sql).toBe(`update "t" set "x" = 'p', "y" = 3 where "a" = 1 and "b" = 2`);
  });

  it("throws when there are no changes or no primary key", () => {
    expect(() => buildUpdate(quoteDoubleQuote, '"t"', { id: 1 }, {})).toThrow(/no changes/i);
    expect(() => buildUpdate(quoteDoubleQuote, '"t"', {}, { x: 1 })).toThrow(/primary key/i);
  });
});
