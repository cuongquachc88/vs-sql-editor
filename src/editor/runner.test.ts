import { describe, it, expect, vi } from "vitest";
import { resolveSql, runAndShow } from "./runner";
import type { HostMessage, WebviewMessage } from "../results/protocol";
import type { ResultsPanel } from "../results/panel";
import type { ConnectionManager } from "../connections/manager";
import type { DatabaseDriver, ResultSet, Session } from "../drivers/types";

describe("resolveSql", () => {
  it("uses the selection when one exists", () => {
    expect(resolveSql("select 1;\nselect 2;", "select 2")).toBe("select 2");
  });
  it("falls back to the whole document when selection is empty", () => {
    expect(resolveSql("select 1;", "")).toBe("select 1;");
  });
});

describe("runAndShow", () => {
  function makePanel(): {
    panel: ResultsPanel;
    posts: HostMessage[];
    setHandler: (fn: (m: WebviewMessage) => void) => void;
  } {
    const posts: HostMessage[] = [];
    let handler: (m: WebviewMessage) => void = () => undefined;
    const panel = {
      post: (m: HostMessage) => {
        posts.push(m);
      },
      setMessageHandler: (fn: (m: WebviewMessage) => void) => {
        handler = fn;
      },
    } as unknown as ResultsPanel;
    return {
      panel,
      posts,
      setHandler: (fn) => {
        handler = fn;
        void handler;
      },
    };
  }

  it("posts a result message with meta.executionMs and connectionLabel", async () => {
    const rs: ResultSet = {
      columns: [{ name: "n", type: "int" }],
      rows: [[1]],
      page: 0,
      pageSize: 500,
    };
    const driver: DatabaseDriver = {
      capabilities: {
        editRows: false,
        cancelQuery: false,
        transactions: false,
        multipleSchemas: false,
      },
      connect: vi.fn(),
      query: vi.fn(async () => rs),
      introspect: vi.fn(),
      buildEditStatement: vi.fn(),
      cancel: vi.fn(),
      dispose: vi.fn(),
    };
    const manager = {
      get: vi.fn(async () => ({ id: "s" }) as Session),
      driverOf: vi.fn(() => driver),
    } as unknown as ConnectionManager;
    const { panel, posts } = makePanel();

    await runAndShow(
      { manager, profileId: "p1", pageSize: 500, panel, connectionLabel: "Local PG" },
      "select 1",
    );

    const result = posts.find((m) => m.type === "result");
    expect(result).toBeDefined();
    if (result?.type === "result") {
      expect(result.meta?.executionMs).toBeTypeOf("number");
      expect(result.meta?.executionMs).toBeGreaterThanOrEqual(0);
      expect(result.meta?.connectionLabel).toBe("Local PG");
    }
  });
});
