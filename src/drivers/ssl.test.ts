// Unit tests for SSL config building — verifies driver behaviour without
// needing real network connections. Mocks pg, mysql2 and @clickhouse/client.
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── mocks must be declared before imports (vitest hoists vi.mock calls) ─────

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () => "FAKE_PEM_CONTENT"),
}));

// Track the options pg.Client was constructed with.
let pgClientOpts: Record<string, unknown> = {};
vi.mock("pg", () => {
  const Client = vi.fn().mockImplementation(function (opts: Record<string, unknown>) {
    pgClientOpts = opts;
  });
  Client.prototype.connect = vi.fn(async () => {});
  Client.prototype.end = vi.fn(async () => {});
  return { Client };
});

// Track the options createConnection was called with.
let mysqlConnOpts: Record<string, unknown> = {};
vi.mock("mysql2/promise", () => ({
  createConnection: vi.fn(async (opts: Record<string, unknown>) => {
    mysqlConnOpts = opts;
    return { end: vi.fn(async () => {}) };
  }),
}));

// Track the options createClient was called with.
let chClientOpts: Record<string, unknown> = {};
vi.mock("@clickhouse/client", () => ({
  createClient: vi.fn((opts: Record<string, unknown>) => {
    chClientOpts = opts;
    return {
      ping: vi.fn(async () => ({ success: true })),
      close: vi.fn(async () => {}),
    };
  }),
}));

import { readFile } from "node:fs/promises";
import { PostgresDriver } from "./postgres";
import { MysqlDriver } from "./mysql";
import { ClickhouseDriver } from "./clickhouse";

// ─── Postgres ────────────────────────────────────────────────────────────────

describe("PostgresDriver SSL config", () => {
  const driver = new PostgresDriver();
  beforeEach(() => {
    vi.clearAllMocks();
    pgClientOpts = {};
    vi.mocked(readFile).mockResolvedValue("FAKE_PEM_CONTENT" as never);
  });

  it("disable: passes ssl=false", async () => {
    await driver.connect(
      { id: "p", name: "t", engine: "postgres", host: "h", sslMode: "disable" },
      "pw",
    );
    expect(pgClientOpts.ssl).toBe(false);
  });

  it("require: rejectUnauthorized=false, no CA read", async () => {
    await driver.connect(
      { id: "p", name: "t", engine: "postgres", host: "h", sslMode: "require" },
      "pw",
    );
    expect((pgClientOpts.ssl as { rejectUnauthorized: boolean }).rejectUnauthorized).toBe(false);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("verify-ca: rejectUnauthorized=true, reads CA file", async () => {
    await driver.connect(
      { id: "p", name: "t", engine: "postgres", host: "h", sslMode: "verify-ca", sslCa: "/ca.pem" },
      "pw",
    );
    const ssl = pgClientOpts.ssl as { rejectUnauthorized: boolean; ca: string };
    expect(ssl.rejectUnauthorized).toBe(true);
    expect(ssl.ca).toBe("FAKE_PEM_CONTENT");
    expect(readFile).toHaveBeenCalledWith("/ca.pem", "utf8");
  });

  it("verify-full: same as verify-ca (rejectUnauthorized=true)", async () => {
    await driver.connect(
      { id: "p", name: "t", engine: "postgres", host: "h", sslMode: "verify-full", sslCa: "/ca.pem" },
      "pw",
    );
    const ssl = pgClientOpts.ssl as { rejectUnauthorized: boolean };
    expect(ssl.rejectUnauthorized).toBe(true);
  });

  it("no sslMode: ssl option is undefined (driver default, no TLS)", async () => {
    await driver.connect({ id: "p", name: "t", engine: "postgres", host: "h" }, "pw");
    expect(pgClientOpts.ssl).toBeUndefined();
  });
});

// ─── MySQL ────────────────────────────────────────────────────────────────────

describe("MysqlDriver SSL config", () => {
  const driver = new MysqlDriver();
  beforeEach(() => {
    vi.clearAllMocks();
    mysqlConnOpts = {};
    vi.mocked(readFile).mockResolvedValue("FAKE_PEM_CONTENT" as never);
  });

  it("no sslMode: ssl option is undefined", async () => {
    await driver.connect({ id: "p", name: "t", engine: "mysql", host: "h" }, "pw");
    expect(mysqlConnOpts.ssl).toBeUndefined();
  });

  it("disable: ssl option is undefined", async () => {
    await driver.connect(
      { id: "p", name: "t", engine: "mysql", host: "h", sslMode: "disable" },
      "pw",
    );
    expect(mysqlConnOpts.ssl).toBeUndefined();
  });

  it("require: rejectUnauthorized=false, no CA read", async () => {
    await driver.connect(
      { id: "p", name: "t", engine: "mysql", host: "h", sslMode: "require" },
      "pw",
    );
    const ssl = mysqlConnOpts.ssl as { rejectUnauthorized: boolean };
    expect(ssl.rejectUnauthorized).toBe(false);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("verify-ca: rejectUnauthorized=true, reads CA file", async () => {
    await driver.connect(
      { id: "p", name: "t", engine: "mysql", host: "h", sslMode: "verify-ca", sslCa: "/ca.pem" },
      "pw",
    );
    const ssl = mysqlConnOpts.ssl as { rejectUnauthorized: boolean; ca: string };
    expect(ssl.rejectUnauthorized).toBe(true);
    expect(ssl.ca).toBe("FAKE_PEM_CONTENT");
    expect(readFile).toHaveBeenCalledWith("/ca.pem", "utf8");
  });

  it("verify-full: rejectUnauthorized=true", async () => {
    await driver.connect(
      { id: "p", name: "t", engine: "mysql", host: "h", sslMode: "verify-full", sslCa: "/ca.pem" },
      "pw",
    );
    const ssl = mysqlConnOpts.ssl as { rejectUnauthorized: boolean };
    expect(ssl.rejectUnauthorized).toBe(true);
  });
});

// ─── ClickHouse ───────────────────────────────────────────────────────────────

describe("ClickhouseDriver SSL config", () => {
  const driver = new ClickhouseDriver();
  beforeEach(() => {
    vi.clearAllMocks();
    chClientOpts = {};
    vi.mocked(readFile).mockResolvedValue(Buffer.from("FAKE_CA") as never);
  });

  it("no sslMode: http:// and port 8123", async () => {
    await driver.connect({ id: "p", name: "t", engine: "clickhouse", host: "ch.host" });
    expect(chClientOpts.url).toBe("http://ch.host:8123");
    expect(chClientOpts.tls).toBeUndefined();
  });

  it("disable: http:// URL", async () => {
    await driver.connect({ id: "p", name: "t", engine: "clickhouse", host: "ch.host", sslMode: "disable" });
    expect(chClientOpts.url as string).toContain("http://");
  });

  it("require: https:// and port 8443, no tls config", async () => {
    await driver.connect({ id: "p", name: "t", engine: "clickhouse", host: "ch.host", sslMode: "require" });
    expect(chClientOpts.url).toBe("https://ch.host:8443");
    expect(chClientOpts.tls).toBeUndefined();
  });

  it("verify-ca: https:// + ca_cert Buffer", async () => {
    await driver.connect({
      id: "p", name: "t", engine: "clickhouse",
      host: "ch.host", sslMode: "verify-ca", sslCa: "/ca.pem",
    });
    expect(chClientOpts.url as string).toContain("https://");
    expect((chClientOpts.tls as { ca_cert: Buffer }).ca_cert).toBeInstanceOf(Buffer);
  });

  it("verify-full: https:// + ca_cert Buffer", async () => {
    await driver.connect({
      id: "p", name: "t", engine: "clickhouse",
      host: "ch.host", sslMode: "verify-full", sslCa: "/ca.pem",
    });
    expect(chClientOpts.url as string).toContain("https://");
    expect((chClientOpts.tls as { ca_cert: Buffer }).ca_cert).toBeInstanceOf(Buffer);
  });

  it("explicit port is preserved even with SSL", async () => {
    await driver.connect({
      id: "p", name: "t", engine: "clickhouse",
      host: "ch.host", port: 9440, sslMode: "require",
    });
    expect(chClientOpts.url).toBe("https://ch.host:9440");
  });
});
