// E2E tests for splitSqlStatements + multi-statement execution against real DB.
// Also covers resolveSql selection logic and onQueryCompleted / onQueryError hooks.
import { describe, it, expect, vi, afterEach } from "vitest";
import { splitSqlStatements } from "../src/editor/sql-split";
import { resolveSql, runAndShow } from "../src/editor/runner";
import { PgliteDriver } from "../src/drivers/pglite";
import type { HostMessage, WebviewMessage } from "../src/results/protocol";
import type { ResultsPanel } from "../src/results/panel";
import type { ConnectionManager } from "../src/connections/manager";
import type { Session } from "../src/drivers/types";

// ─── splitSqlStatements ───────────────────────────────────────────────────────

describe("splitSqlStatements — advanced cases", () => {
  it("splits DDL + DML correctly", () => {
    const sql = `
      create table t (id int);
      insert into t values (1);
      select * from t;
    `;
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(3);
    expect(stmts[0]).toContain("create table");
    expect(stmts[1]).toContain("insert");
    expect(stmts[2]).toContain("select");
  });

  it("does not split on semicolons inside string literals", () => {
    const sql = `select 'a;b;c' as s`;
    expect(splitSqlStatements(sql)).toHaveLength(1);
  });

  it("does not split on semicolons inside line comments", () => {
    const sql = `-- this is a comment; ignore me\nselect 1`;
    expect(splitSqlStatements(sql)).toHaveLength(1);
  });

  it("does not split on semicolons inside block comments", () => {
    const sql = `/* multi;\nline; comment */\nselect 2`;
    expect(splitSqlStatements(sql)).toHaveLength(1);
  });

  it("handles double-quoted identifiers with embedded semicolons", () => {
    const sql = `select "col;name" from t`;
    expect(splitSqlStatements(sql)).toHaveLength(1);
  });

  it("returns empty array for whitespace-only input", () => {
    expect(splitSqlStatements("   \n  \t  ")).toHaveLength(0);
  });

  it("strips trailing semicolons from each statement", () => {
    const stmts = splitSqlStatements("select 1;select 2;");
    expect(stmts[0]).toBe("select 1");
    expect(stmts[1]).toBe("select 2");
  });
});

// ─── resolveSql ───────────────────────────────────────────────────────────────

describe("resolveSql", () => {
  it("prefers selection over full document", () => {
    expect(resolveSql("select 1;\nselect 2;", "select 2;")).toBe("select 2;");
  });

  it("falls back to full document when selection is whitespace", () => {
    expect(resolveSql("select 1;", "   ")).toBe("select 1;");
  });

  it("trims surrounding whitespace from document text", () => {
    expect(resolveSql("  select 1;  ", "")).toBe("select 1;");
  });
});

// ─── runAndShow E2E ──────────────────────────────────────────────────────────

function makePanel(): { panel: ResultsPanel; posts: HostMessage[]; triggerMsg(m: WebviewMessage): Promise<void> } {
  const posts: HostMessage[] = [];
  let handler: ((m: WebviewMessage) => void | Promise<void>) | undefined;
  const panel = {
    post: (m: HostMessage) => { posts.push(m); },
    setMessageHandler: (fn: (m: WebviewMessage) => void | Promise<void>) => { handler = fn; },
  } as unknown as ResultsPanel;
  return {
    panel,
    posts,
    triggerMsg: async (m) => { await handler?.(m); },
  };
}

describe("runAndShow E2E — PGlite", () => {
  const driver = new PgliteDriver();
  let session: Session | undefined;

  afterEach(async () => {
    if (session) { await driver.dispose(session); session = undefined; }
  });

  function makeManager(s: Session): ConnectionManager {
    return {
      get: async () => s,
      driverOf: () => driver,
    } as unknown as ConnectionManager;
  }

  it("posts loading then result messages for a SELECT", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    const { panel, posts } = makePanel();

    await runAndShow(
      { manager: makeManager(session), profileId: "m", pageSize: 10, panel, connectionLabel: "test" },
      "select 1 as n",
    );

    expect(posts.some((p) => p.type === "loading")).toBe(true);
    const result = posts.find((p) => p.type === "result");
    expect(result).toBeDefined();
    if (result?.type === "result") {
      expect(result.data.rows[0][0]).toBe(1);
      expect(result.meta?.connectionLabel).toBe("test");
      expect(result.meta?.executionMs).toBeTypeOf("number");
    }
  });

  it("posts error message for an invalid query", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    const { panel, posts } = makePanel();
    const onQueryError = vi.fn();

    await runAndShow(
      { manager: makeManager(session), profileId: "m", pageSize: 10, panel, onQueryError },
      "select * from no_such_table",
    );

    expect(posts.some((p) => p.type === "error")).toBe(true);
    expect(onQueryError).toHaveBeenCalledOnce();
    expect(onQueryError.mock.calls[0][0].sql).toBe("select * from no_such_table");
  });

  it("onQueryCompleted is called once even across multiple pages", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    await driver.query(session, "create table nums (n int)");
    await driver.query(session, "insert into nums select g from generate_series(1,10) g");

    const { panel, triggerMsg } = makePanel();
    const onQueryCompleted = vi.fn();

    await runAndShow(
      { manager: makeManager(session), profileId: "m", pageSize: 3, panel, onQueryCompleted },
      "select n from nums order by n",
    );

    // Trigger a page change and wait for the async handler to finish
    await triggerMsg({ type: "requestPage", page: 1 });

    // Should still be called only once
    expect(onQueryCompleted).toHaveBeenCalledOnce();
    expect(onQueryCompleted.mock.calls[0][0].ok).toBe(true);
  });

  it("multi-statement batch: split + run each statement in sequence", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });

    const sql = `
      create table batch_test (id int, val text);
      insert into batch_test values (1, 'hello');
      insert into batch_test values (2, 'world');
    `;
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(3);

    for (const stmt of stmts) {
      await driver.query(session, stmt);
    }

    const rs = await driver.query(session, "select val from batch_test order by id");
    expect(rs.rows.map((r) => r[0])).toEqual(["hello", "world"]);
  });

  it("requestPage posts a fresh result with the correct page offset", async () => {
    session = await driver.connect({ id: "m", name: "m", engine: "pglite" });
    await driver.query(session, "create table pg_test (n int)");
    await driver.query(session, "insert into pg_test select g from generate_series(1,15) g");

    const { panel, posts, triggerMsg } = makePanel();

    await runAndShow(
      { manager: makeManager(session), profileId: "m", pageSize: 5, panel },
      "select n from pg_test order by n",
    );

    // Request page 2 (rows 11-15) and wait for the async handler
    await triggerMsg({ type: "requestPage", page: 2 });

    const results = posts.filter((p) => p.type === "result");
    expect(results.length).toBeGreaterThanOrEqual(2);
    const last = results[results.length - 1];
    if (last.type === "result") {
      expect(last.data.page).toBe(2);
      expect(last.data.rows[0][0]).toBe(11);
    }
  });
});
