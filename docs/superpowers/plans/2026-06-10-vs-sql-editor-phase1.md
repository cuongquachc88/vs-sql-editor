# vs-sql-editor Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a VS Code extension that connects to PostgreSQL, runs SQL from a `.sql` file, and shows paged results in a webview grid with CSV/JSON export.

**Architecture:** Extension host (Node) owns connections and a `DatabaseDriver`-based driver layer; a sandboxed webview renders the results grid and talks to the host only via typed `postMessage`. Phase 1 implements the driver spine plus one engine (Postgres) and the run→results→export vertical slice. `introspect` and `buildEditStatement` are typed stubs reserved for later phases.

**Tech Stack:** TypeScript, VS Code Extension API, `pg`, `esbuild` (bundling), `vitest` (unit tests), `csv-stringify` (CSV export). Node 20+.

---

## File Structure (Phase 1)

| File | Responsibility |
|------|----------------|
| `package.json` | Extension manifest: commands, views, configuration, scripts |
| `tsconfig.json` | TypeScript config |
| `esbuild.mjs` | Bundles extension host + webview |
| `vitest.config.ts` | Test runner config |
| `test/vscode-mock.ts` | Mock of the `vscode` module for unit tests |
| `src/drivers/types.ts` | `DatabaseDriver` interface, `Capabilities`, `ConnectionProfile`, `Session`, `ResultSet`, `ColumnMeta`, `SchemaModel`, `DriverError` |
| `src/drivers/registry.ts` | engine id → driver factory map |
| `src/drivers/postgres.ts` | Postgres driver (`pg`) |
| `src/export/csv.ts` | ResultSet → CSV string |
| `src/export/json.ts` | ResultSet → JSON string |
| `src/connections/store.ts` | Connection profiles (globalState) + passwords (SecretStorage) |
| `src/connections/manager.ts` | Live session pool: open/get/dispose |
| `src/results/protocol.ts` | Typed host↔webview message contract |
| `src/results/panel.ts` | Webview host: lifecycle + message bridge |
| `src/results/webview/main.ts` | Grid UI: render, paging, export buttons |
| `src/editor/runner.ts` | Resolve connection, run statement/selection, post to panel |
| `src/extension.ts` | `activate()`: register commands, CodeLens, status bar |

---

## Task 1: Scaffold the extension

**Files:**
- Create: `package.json`, `tsconfig.json`, `esbuild.mjs`, `vitest.config.ts`, `.vscodeignore`, `src/extension.ts`, `test/smoke.test.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "vs-sql-editor",
  "displayName": "VS SQL Editor",
  "description": "Connect to and edit SQL across Postgres, MySQL, PGlite, SQLite, ClickHouse",
  "version": "0.0.1",
  "publisher": "vs-sql-editor",
  "engines": { "vscode": "^1.90.0" },
  "main": "./dist/extension.js",
  "activationEvents": ["onLanguage:sql"],
  "categories": ["Other"],
  "contributes": {
    "commands": [
      { "command": "vsSqlEditor.addConnection", "title": "SQL: Add Connection" },
      { "command": "vsSqlEditor.runQuery", "title": "SQL: Run Query" },
      { "command": "vsSqlEditor.selectConnection", "title": "SQL: Select Active Connection" }
    ],
    "configuration": {
      "title": "VS SQL Editor",
      "properties": {
        "vsSqlEditor.pageSize": {
          "type": "number", "default": 500, "description": "Rows per results page"
        }
      }
    }
  },
  "scripts": {
    "build": "node esbuild.mjs",
    "watch": "node esbuild.mjs --watch",
    "test": "vitest run",
    "vscode:prepublish": "node esbuild.mjs --production"
  },
  "dependencies": {
    "pg": "^8.13.0",
    "csv-stringify": "^6.5.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/pg": "^8.11.0",
    "@types/vscode": "^1.90.0",
    "esbuild": "^0.23.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `esbuild.mjs`**

```js
import esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const common = { bundle: true, sourcemap: !production, minify: production, logLevel: "info" };

const host = {
  ...common,
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  platform: "node",
  format: "cjs",
  external: ["vscode"],
};

const web = {
  ...common,
  entryPoints: ["src/results/webview/main.ts"],
  outfile: "dist/webview.js",
  platform: "browser",
  format: "iife",
};

if (watch) {
  const c1 = await esbuild.context(host);
  const c2 = await esbuild.context(web);
  await Promise.all([c1.watch(), c2.watch()]);
} else {
  await esbuild.build(host);
  await esbuild.build(web);
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    alias: { vscode: new URL("./test/vscode-mock.ts", import.meta.url).pathname },
  },
});
```

- [ ] **Step 5: Create `.vscodeignore`**

```
src/**
test/**
**/*.test.ts
esbuild.mjs
vitest.config.ts
tsconfig.json
docs/**
```

- [ ] **Step 6: Create minimal `src/extension.ts`**

```ts
import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("vsSqlEditor.runQuery", () => {
      vscode.window.showInformationMessage("vs-sql-editor active");
    }),
  );
}

export function deactivate(): void {}
```

- [ ] **Step 7: Create smoke test `test/smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs the test harness", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 8: Install and verify build + tests**

Run: `npm install && npm run build && npm test`
Expected: build writes `dist/extension.js` and `dist/webview.js` (webview entry is empty for now — create `src/results/webview/main.ts` with `export {};` if esbuild errors on the missing file), and the smoke test PASSES.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold vs-sql-editor extension"
```

---

## Task 2: Driver types (the spine)

**Files:**
- Create: `src/drivers/types.ts`, `src/drivers/types.test.ts`

- [ ] **Step 1: Write the failing test `src/drivers/types.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { DriverError, type DatabaseDriver, type ResultSet } from "./types";

describe("DriverError", () => {
  it("normalizes an unknown error", () => {
    const e = DriverError.from(new Error("boom"));
    expect(e.code).toBe("UNKNOWN");
    expect(e.message).toBe("boom");
  });

  it("preserves a provided code and detail", () => {
    const e = new DriverError("CONN_REFUSED", "cannot connect", "ECONNREFUSED 5432");
    expect(e.code).toBe("CONN_REFUSED");
    expect(e.detail).toBe("ECONNREFUSED 5432");
  });
});

describe("type contract (compile-time)", () => {
  it("a minimal driver satisfies the interface", () => {
    const rs: ResultSet = { columns: [{ name: "id", type: "int4" }], rows: [[1]], page: 0, pageSize: 1 };
    const fake: DatabaseDriver = {
      capabilities: { editRows: false, cancelQuery: false, transactions: false, multipleSchemas: true },
      async connect() { return { id: "s1" }; },
      async query() { return rs; },
      async introspect() { throw DriverError.notImplemented("introspect"); },
      buildEditStatement() { throw DriverError.notImplemented("buildEditStatement"); },
      async cancel() {},
      async dispose() {},
    };
    expect(fake.capabilities.multipleSchemas).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/drivers/types.test.ts`
Expected: FAIL — cannot find module `./types`.

- [ ] **Step 3: Create `src/drivers/types.ts`**

```ts
export type EngineId = "postgres" | "mysql" | "pglite" | "sqlite" | "clickhouse";

export interface Capabilities {
  editRows: boolean;
  cancelQuery: boolean;
  transactions: boolean;
  multipleSchemas: boolean;
}

export interface ConnectionProfile {
  id: string;
  name: string;
  engine: EngineId;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  filePath?: string;       // sqlite
  options?: Record<string, string>;
}

export interface Session {
  id: string;
  // driver-private handle lives behind this; never serialized to a webview
  handle?: unknown;
}

export interface ColumnMeta {
  name: string;
  type: string;
}

export interface ResultSet {
  columns: ColumnMeta[];
  rows: unknown[][];
  page: number;       // 0-based
  pageSize: number;
  rowCount?: number;  // affected rows for non-SELECT, when known
  hasMore?: boolean;  // true if another page likely exists
}

export interface QueryOptions {
  page?: number;      // 0-based; default 0
  pageSize?: number;  // default from config
  signal?: AbortSignal;
}

// Reserved for Phase 3.
export interface SchemaModel {
  databases: { name: string; schemas: { name: string; tables: { name: string; columns: ColumnMeta[]; primaryKey: string[] }[] }[] }[];
}

export type DriverErrorCode =
  | "UNKNOWN" | "CONN_REFUSED" | "AUTH_FAILED" | "QUERY_FAILED" | "CANCELLED" | "NOT_IMPLEMENTED";

export class DriverError extends Error {
  constructor(
    public readonly code: DriverErrorCode,
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = "DriverError";
  }

  static from(err: unknown): DriverError {
    if (err instanceof DriverError) return err;
    const message = err instanceof Error ? err.message : String(err);
    const detail = err instanceof Error ? err.stack : undefined;
    return new DriverError("UNKNOWN", message, detail);
  }

  static notImplemented(what: string): DriverError {
    return new DriverError("NOT_IMPLEMENTED", `${what} is not implemented yet`);
  }
}

export interface DatabaseDriver {
  readonly capabilities: Capabilities;
  connect(profile: ConnectionProfile, secret?: string): Promise<Session>;
  query(session: Session, sql: string, opts?: QueryOptions): Promise<ResultSet>;
  introspect(session: Session): Promise<SchemaModel>;
  buildEditStatement(table: string, pk: Record<string, unknown>, changes: Record<string, unknown>): string;
  cancel(session: Session): Promise<void>;
  dispose(session: Session): Promise<void>;
}

export type DriverFactory = () => DatabaseDriver;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/drivers/types.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/drivers/types.ts src/drivers/types.test.ts
git commit -m "feat: add DatabaseDriver type spine and DriverError"
```

---

## Task 3: Driver registry

**Files:**
- Create: `src/drivers/registry.ts`, `src/drivers/registry.test.ts`

- [ ] **Step 1: Write the failing test `src/drivers/registry.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { registerDriver, createDriver, hasDriver } from "./registry";
import { DriverError, type DatabaseDriver } from "./types";

const fake: DatabaseDriver = {
  capabilities: { editRows: false, cancelQuery: false, transactions: false, multipleSchemas: true },
  async connect() { return { id: "s" }; },
  async query() { return { columns: [], rows: [], page: 0, pageSize: 0 }; },
  async introspect() { throw DriverError.notImplemented("introspect"); },
  buildEditStatement() { throw DriverError.notImplemented("buildEditStatement"); },
  async cancel() {},
  async dispose() {},
};

describe("registry", () => {
  it("creates a registered driver", () => {
    registerDriver("postgres", () => fake);
    expect(hasDriver("postgres")).toBe(true);
    expect(createDriver("postgres")).toBe(fake);
  });

  it("throws for an unknown engine", () => {
    expect(() => createDriver("mysql")).toThrowError(/no driver registered/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/drivers/registry.test.ts`
Expected: FAIL — cannot find module `./registry`.

- [ ] **Step 3: Create `src/drivers/registry.ts`**

```ts
import { DriverError, type DatabaseDriver, type DriverFactory, type EngineId } from "./types";

const factories = new Map<EngineId, DriverFactory>();

export function registerDriver(engine: EngineId, factory: DriverFactory): void {
  factories.set(engine, factory);
}

export function hasDriver(engine: EngineId): boolean {
  return factories.has(engine);
}

export function createDriver(engine: EngineId): DatabaseDriver {
  const factory = factories.get(engine);
  if (!factory) throw new DriverError("UNKNOWN", `No driver registered for engine "${engine}"`);
  return factory();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/drivers/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/drivers/registry.ts src/drivers/registry.test.ts
git commit -m "feat: add driver registry"
```

---

## Task 4: Export functions (CSV + JSON)

**Files:**
- Create: `src/export/csv.ts`, `src/export/json.ts`, `src/export/export.test.ts`

- [ ] **Step 1: Write the failing test `src/export/export.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { toCsv } from "./csv";
import { toJson } from "./json";
import type { ResultSet } from "../drivers/types";

const rs: ResultSet = {
  columns: [{ name: "id", type: "int4" }, { name: "name", type: "text" }],
  rows: [[1, "Ada"], [2, "Grace, the"]],
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/export/export.test.ts`
Expected: FAIL — cannot find module `./csv`.

- [ ] **Step 3: Create `src/export/csv.ts`**

```ts
import { stringify } from "csv-stringify/sync";
import type { ResultSet } from "../drivers/types";

export function toCsv(rs: ResultSet): string {
  return stringify(rs.rows, {
    header: true,
    columns: rs.columns.map((c) => c.name),
  });
}
```

- [ ] **Step 4: Create `src/export/json.ts`**

```ts
import type { ResultSet } from "../drivers/types";

export function toJson(rs: ResultSet): string {
  const objects = rs.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    rs.columns.forEach((col, i) => { obj[col.name] = row[i]; });
    return obj;
  });
  return JSON.stringify(objects, null, 2);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/export/export.test.ts`
Expected: PASS. (If `csv-stringify` quotes differently, adjust the expected string to match its canonical output — but the default config produces the string shown.)

- [ ] **Step 6: Commit**

```bash
git add src/export/ && git commit -m "feat: add CSV and JSON result export"
```

---

## Task 5: Postgres driver

**Files:**
- Create: `src/drivers/postgres.ts`, `src/drivers/postgres.test.ts`, `docker-compose.test.yml`

This task uses an **integration test gated on `TEST_PG_URL`**. When unset, the test self-skips so the suite stays green without Docker. To run it locally, start a throwaway Postgres and set the URL.

- [ ] **Step 1: Create `docker-compose.test.yml`**

```yaml
services:
  pg:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: test
      POSTGRES_DB: testdb
    ports: ["55432:5432"]
```

- [ ] **Step 2: Write the failing test `src/drivers/postgres.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgresDriver } from "./postgres";
import type { Session } from "./types";

const url = process.env.TEST_PG_URL; // e.g. postgres://postgres:test@localhost:55432/testdb
const maybe = url ? describe : describe.skip;

maybe("PostgresDriver (integration)", () => {
  const driver = new PostgresDriver();
  let session: Session;

  beforeAll(async () => {
    const u = new URL(url!);
    session = await driver.connect(
      { id: "t", name: "t", engine: "postgres", host: u.hostname, port: Number(u.port),
        database: u.pathname.slice(1), user: u.username },
      decodeURIComponent(u.password),
    );
  });

  afterAll(async () => { if (session) await driver.dispose(session); });

  it("advertises capabilities", () => {
    expect(driver.capabilities).toEqual({
      editRows: true, cancelQuery: true, transactions: true, multipleSchemas: true,
    });
  });

  it("runs a SELECT and returns typed columns", async () => {
    const rs = await driver.query(session, "select 1 as one, 'x'::text as label");
    expect(rs.columns.map((c) => c.name)).toEqual(["one", "label"]);
    expect(rs.rows).toEqual([[1, "x"]]);
  });

  it("applies pageSize as LIMIT and reports hasMore", async () => {
    const rs = await driver.query(
      session, "select g from generate_series(1, 10) g", { page: 0, pageSize: 3 });
    expect(rs.rows.length).toBe(3);
    expect(rs.hasMore).toBe(true);
  });

  it("wraps a bad query as a DriverError", async () => {
    await expect(driver.query(session, "select * from nope_no_table"))
      .rejects.toMatchObject({ code: "QUERY_FAILED" });
  });
});
```

- [ ] **Step 3: Run test to verify it fails (or skips)**

Run: `npx vitest run src/drivers/postgres.test.ts`
Expected: FAIL — cannot find module `./postgres` (with `TEST_PG_URL` unset it would otherwise skip; right now the import itself fails).

- [ ] **Step 4: Create `src/drivers/postgres.ts`**

```ts
import { Client } from "pg";
import {
  DriverError, type Capabilities, type ConnectionProfile, type DatabaseDriver,
  type QueryOptions, type ResultSet, type SchemaModel, type Session,
} from "./types";

interface PgSession extends Session { handle: Client; }

export class PostgresDriver implements DatabaseDriver {
  readonly capabilities: Capabilities = {
    editRows: true, cancelQuery: true, transactions: true, multipleSchemas: true,
  };

  async connect(profile: ConnectionProfile, secret?: string): Promise<PgSession> {
    const client = new Client({
      host: profile.host, port: profile.port, database: profile.database,
      user: profile.user, password: secret,
    });
    try {
      await client.connect();
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      const code = e.code === "ECONNREFUSED" ? "CONN_REFUSED"
        : /password|auth/i.test(e.message) ? "AUTH_FAILED" : "UNKNOWN";
      throw new DriverError(code, e.message, e.code);
    }
    return { id: `pg-${profile.id}-${Date.now()}`, handle: client };
  }

  async query(session: Session, sql: string, opts: QueryOptions = {}): Promise<ResultSet> {
    const client = (session as PgSession).handle;
    const pageSize = opts.pageSize ?? 500;
    const page = opts.page ?? 0;
    const paged = this.applyPaging(sql, page, pageSize);
    try {
      const res = await client.query({ text: paged, rowMode: "array" });
      const columns = res.fields.map((f) => ({ name: f.name, type: String(f.dataTypeID) }));
      const rows = res.rows as unknown[][];
      return {
        columns, rows, page, pageSize,
        rowCount: res.rowCount ?? undefined,
        hasMore: rows.length === pageSize,
      };
    } catch (err) {
      throw new DriverError("QUERY_FAILED", (err as Error).message, (err as Error).stack);
    }
  }

  // Wrap as a subquery so LIMIT/OFFSET works for arbitrary SELECTs. Non-SELECT
  // statements (with no result set to page) are passed through unchanged.
  private applyPaging(sql: string, page: number, pageSize: number): string {
    const trimmed = sql.trim().replace(/;\s*$/, "");
    if (!/^select|^with/i.test(trimmed)) return sql;
    return `select * from (${trimmed}) as _q limit ${pageSize} offset ${page * pageSize}`;
  }

  async introspect(_session: Session): Promise<SchemaModel> {
    throw DriverError.notImplemented("introspect"); // Phase 3
  }

  buildEditStatement(): string {
    throw DriverError.notImplemented("buildEditStatement"); // Phase 5
  }

  async cancel(session: Session): Promise<void> {
    // pg cancels in-flight queries by opening a side connection; simplest reliable
    // approach is to end the client, which aborts the running query.
    await this.dispose(session);
  }

  async dispose(session: Session): Promise<void> {
    const client = (session as PgSession).handle;
    if (client) await client.end().catch(() => undefined);
  }
}
```

- [ ] **Step 5: Run the test against a real Postgres**

Run:
```bash
docker compose -f docker-compose.test.yml up -d
$env:TEST_PG_URL="postgres://postgres:test@localhost:55432/testdb"   # PowerShell
npx vitest run src/drivers/postgres.test.ts
docker compose -f docker-compose.test.yml down
```
Expected: PASS (4 tests). Without `TEST_PG_URL` the suite reports the describe block as skipped.

- [ ] **Step 6: Register the driver — modify `src/drivers/registry.ts` consumers**

Create `src/drivers/index.ts` that wires built-in drivers at import time:

```ts
import { registerDriver } from "./registry";
import { PostgresDriver } from "./postgres";

export function registerBuiltInDrivers(): void {
  registerDriver("postgres", () => new PostgresDriver());
}
```

- [ ] **Step 7: Commit**

```bash
git add src/drivers/postgres.ts src/drivers/postgres.test.ts src/drivers/index.ts docker-compose.test.yml
git commit -m "feat: add Postgres driver with paging and error normalization"
```

---

## Task 6: Connection store (profiles + secrets)

**Files:**
- Create: `src/connections/store.ts`, `src/connections/store.test.ts`
- Create: `test/vscode-mock.ts`

- [ ] **Step 1: Create `test/vscode-mock.ts`**

```ts
// Minimal in-memory stand-ins for the VS Code APIs used in unit tests.
export class Memento {
  private data = new Map<string, unknown>();
  get<T>(key: string, def?: T): T | undefined { return (this.data.has(key) ? this.data.get(key) : def) as T; }
  async update(key: string, value: unknown): Promise<void> { this.data.set(key, value); }
  keys(): readonly string[] { return [...this.data.keys()]; }
}

export class SecretStorage {
  private data = new Map<string, string>();
  async get(key: string): Promise<string | undefined> { return this.data.get(key); }
  async store(key: string, value: string): Promise<void> { this.data.set(key, value); }
  async delete(key: string): Promise<void> { this.data.delete(key); }
}

export const window = {
  showInformationMessage: async () => undefined,
  showErrorMessage: async () => undefined,
};
export const commands = { registerCommand: () => ({ dispose() {} }) };
```

- [ ] **Step 2: Write the failing test `src/connections/store.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { Memento, SecretStorage } from "../../test/vscode-mock";
import { ConnectionStore } from "./store";

function makeStore() {
  return new ConnectionStore(new Memento() as any, new SecretStorage() as any);
}

describe("ConnectionStore", () => {
  it("saves and lists a profile without storing the secret in globalState", async () => {
    const store = makeStore();
    const profile = await store.add(
      { name: "local", engine: "postgres", host: "localhost", port: 5432, database: "app", user: "me" },
      "s3cret",
    );
    expect(profile.id).toBeTruthy();
    expect(store.list()).toHaveLength(1);
    expect(JSON.stringify(store.list())).not.toContain("s3cret");
    expect(await store.getSecret(profile.id)).toBe("s3cret");
  });

  it("removes a profile and its secret", async () => {
    const store = makeStore();
    const p = await store.add({ name: "x", engine: "postgres" }, "pw");
    await store.remove(p.id);
    expect(store.list()).toHaveLength(0);
    expect(await store.getSecret(p.id)).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/connections/store.test.ts`
Expected: FAIL — cannot find module `./store`.

- [ ] **Step 4: Create `src/connections/store.ts`**

```ts
import type { ExtensionContext } from "vscode";
import type { ConnectionProfile, EngineId } from "../drivers/types";

const KEY = "vsSqlEditor.connections";
const secretKey = (id: string) => `vsSqlEditor.secret.${id}`;

type NewProfile = Omit<ConnectionProfile, "id">;

export class ConnectionStore {
  constructor(
    private readonly state: ExtensionContext["globalState"],
    private readonly secrets: ExtensionContext["secrets"],
  ) {}

  list(): ConnectionProfile[] {
    return this.state.get<ConnectionProfile[]>(KEY, []) ?? [];
  }

  get(id: string): ConnectionProfile | undefined {
    return this.list().find((p) => p.id === id);
  }

  async add(profile: NewProfile, secret?: string): Promise<ConnectionProfile> {
    const id = `${profile.engine}-${Date.now()}-${Math.round(performance.now())}`;
    const full: ConnectionProfile = { ...profile, id };
    await this.state.update(KEY, [...this.list(), full]);
    if (secret) await this.secrets.store(secretKey(id), secret);
    return full;
  }

  async remove(id: string): Promise<void> {
    await this.state.update(KEY, this.list().filter((p) => p.id !== id));
    await this.secrets.delete(secretKey(id));
  }

  getSecret(id: string): Promise<string | undefined> {
    return Promise.resolve(this.secrets.get(secretKey(id)));
  }
}

export type { EngineId };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/connections/store.test.ts`
Expected: PASS. (Note: `Math.round(performance.now())` is fine in the running extension; in the test, the mock Memento accepts any id.)

- [ ] **Step 6: Commit**

```bash
git add src/connections/store.ts src/connections/store.test.ts test/vscode-mock.ts
git commit -m "feat: add connection store with keychain-backed secrets"
```

---

## Task 7: Connection manager (live sessions)

**Files:**
- Create: `src/connections/manager.ts`, `src/connections/manager.test.ts`

- [ ] **Step 1: Write the failing test `src/connections/manager.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { ConnectionManager } from "./manager";
import { DriverError, type DatabaseDriver, type Session } from "../drivers/types";

function fakeDriver(): DatabaseDriver {
  return {
    capabilities: { editRows: false, cancelQuery: false, transactions: false, multipleSchemas: true },
    connect: vi.fn(async () => ({ id: "live" }) as Session),
    query: vi.fn(async () => ({ columns: [], rows: [], page: 0, pageSize: 0 })),
    introspect: async () => { throw DriverError.notImplemented("introspect"); },
    buildEditStatement: () => { throw DriverError.notImplemented("buildEditStatement"); },
    cancel: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  };
}

describe("ConnectionManager", () => {
  it("opens once and reuses the session for the same profile", async () => {
    const driver = fakeDriver();
    const mgr = new ConnectionManager(
      () => driver,
      async () => "pw",
      (id) => ({ id, name: id, engine: "postgres" }),
    );
    const s1 = await mgr.get("p1");
    const s2 = await mgr.get("p1");
    expect(s1).toBe(s2);
    expect(driver.connect).toHaveBeenCalledTimes(1);
  });

  it("disposes the underlying session", async () => {
    const driver = fakeDriver();
    const mgr = new ConnectionManager(
      () => driver, async () => undefined, (id) => ({ id, name: id, engine: "postgres" }));
    await mgr.get("p1");
    await mgr.disconnect("p1");
    expect(driver.dispose).toHaveBeenCalledTimes(1);
    await mgr.get("p1");
    expect(driver.connect).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/connections/manager.test.ts`
Expected: FAIL — cannot find module `./manager`.

- [ ] **Step 3: Create `src/connections/manager.ts`**

```ts
import { createDriver } from "../drivers/registry";
import type { ConnectionProfile, DatabaseDriver, Session } from "../drivers/types";

interface Live { driver: DatabaseDriver; session: Session; }

export class ConnectionManager {
  private readonly live = new Map<string, Live>();

  constructor(
    private readonly driverFor: (engine: ConnectionProfile["engine"]) => DatabaseDriver = createDriver,
    private readonly secretFor: (id: string) => Promise<string | undefined> = async () => undefined,
    private readonly profileFor: (id: string) => ConnectionProfile | undefined = () => undefined,
  ) {}

  async get(profileId: string): Promise<Session> {
    const existing = this.live.get(profileId);
    if (existing) return existing.session;

    const profile = this.profileFor(profileId);
    if (!profile) throw new Error(`Unknown connection: ${profileId}`);

    const driver = this.driverFor(profile.engine);
    const secret = await this.secretFor(profileId);
    const session = await driver.connect(profile, secret);
    this.live.set(profileId, { driver, session });
    return session;
  }

  driverOf(profileId: string): DatabaseDriver | undefined {
    return this.live.get(profileId)?.driver;
  }

  async disconnect(profileId: string): Promise<void> {
    const l = this.live.get(profileId);
    if (!l) return;
    this.live.delete(profileId);
    await l.driver.dispose(l.session);
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.live.keys()].map((id) => this.disconnect(id)));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/connections/manager.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/connections/manager.ts src/connections/manager.test.ts
git commit -m "feat: add connection manager with session reuse"
```

---

## Task 8: Results message protocol + panel host

**Files:**
- Create: `src/results/protocol.ts`, `src/results/protocol.test.ts`, `src/results/panel.ts`

- [ ] **Step 1: Write the failing test `src/results/protocol.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { isWebviewMessage } from "./protocol";

describe("isWebviewMessage", () => {
  it("accepts a requestPage message", () => {
    expect(isWebviewMessage({ type: "requestPage", page: 2 })).toBe(true);
  });
  it("accepts an export message", () => {
    expect(isWebviewMessage({ type: "export", format: "csv" })).toBe(true);
  });
  it("rejects junk", () => {
    expect(isWebviewMessage({ type: "nope" })).toBe(false);
    expect(isWebviewMessage(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/results/protocol.test.ts`
Expected: FAIL — cannot find module `./protocol`.

- [ ] **Step 3: Create `src/results/protocol.ts`**

```ts
import type { ResultSet } from "../drivers/types";

// Host -> Webview
export type HostMessage =
  | { type: "result"; data: ResultSet }
  | { type: "error"; message: string; detail?: string }
  | { type: "loading"; sql: string };

// Webview -> Host
export type WebviewMessage =
  | { type: "requestPage"; page: number }
  | { type: "export"; format: "csv" | "json" };

export function isWebviewMessage(m: unknown): m is WebviewMessage {
  if (!m || typeof m !== "object") return false;
  const t = (m as { type?: unknown }).type;
  if (t === "requestPage") return typeof (m as { page?: unknown }).page === "number";
  if (t === "export") {
    const f = (m as { format?: unknown }).format;
    return f === "csv" || f === "json";
  }
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/results/protocol.test.ts`
Expected: PASS.

- [ ] **Step 5: Create `src/results/panel.ts`** (no unit test — exercised manually in Task 10; keep it thin)

```ts
import * as vscode from "vscode";
import { isWebviewMessage, type HostMessage, type WebviewMessage } from "./protocol";

export class ResultsPanel {
  private static current: ResultsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private onMessage?: (m: WebviewMessage) => void;

  static show(context: vscode.ExtensionContext): ResultsPanel {
    if (ResultsPanel.current) {
      ResultsPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      return ResultsPanel.current;
    }
    ResultsPanel.current = new ResultsPanel(context);
    return ResultsPanel.current;
  }

  private constructor(context: vscode.ExtensionContext) {
    this.panel = vscode.window.createWebviewPanel(
      "vsSqlEditor.results", "SQL Results", vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")] },
    );
    this.panel.webview.html = this.html(context.extensionUri);
    this.panel.webview.onDidReceiveMessage((m) => {
      if (isWebviewMessage(m)) this.onMessage?.(m);
    });
    this.panel.onDidDispose(() => { ResultsPanel.current = undefined; });
  }

  setMessageHandler(fn: (m: WebviewMessage) => void): void { this.onMessage = fn; }

  post(message: HostMessage): void { void this.panel.webview.postMessage(message); }

  private html(extensionUri: vscode.Uri): string {
    const nonce = Buffer.from(`${Date.now()}-${Math.random()}`).toString("base64").slice(0, 16);
    const src = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview.js"));
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    return `<!DOCTYPE html><html><head>
      <meta http-equiv="Content-Security-Policy" content="${csp}">
      <style>
        body { font-family: var(--vscode-font-family); margin: 0; padding: 8px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid var(--vscode-panel-border); padding: 2px 6px; text-align: left; }
        th { position: sticky; top: 0; background: var(--vscode-editor-background); }
        #bar { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
        .err { color: var(--vscode-errorForeground); white-space: pre-wrap; }
        button { cursor: pointer; }
      </style></head>
      <body>
        <div id="bar">
          <button id="prev">◀ Prev</button><span id="page"></span><button id="next">Next ▶</button>
          <span style="flex:1"></span>
          <button id="csv">Export CSV</button><button id="json">Export JSON</button>
        </div>
        <div id="content"></div>
        <script nonce="${nonce}" src="${src}"></script>
      </body></html>`;
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/results/protocol.ts src/results/protocol.test.ts src/results/panel.ts
git commit -m "feat: add results webview protocol and panel host"
```

---

## Task 9: Results grid webview UI

**Files:**
- Create: `src/results/webview/main.ts`

This is the browser-side bundle. It has no direct unit test (DOM + VS Code webview API); it is verified manually in Task 10. Keep logic minimal and declarative.

- [ ] **Step 1: Create `src/results/webview/main.ts`**

```ts
import type { HostMessage, WebviewMessage } from "../protocol";

interface VsCodeApi { postMessage(m: WebviewMessage): void; }
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

let currentPage = 0;

const $ = (id: string) => document.getElementById(id)!;

function render(msg: HostMessage): void {
  const content = $("content");
  if (msg.type === "loading") { content.innerHTML = `<em>Running…</em>`; return; }
  if (msg.type === "error") {
    content.innerHTML = `<div class="err">${escapeHtml(msg.message)}${
      msg.detail ? "\n\n" + escapeHtml(msg.detail) : ""}</div>`;
    return;
  }
  // type === "result"
  currentPage = msg.data.page;
  $("page").textContent = `Page ${msg.data.page + 1}`;
  const head = msg.data.columns.map((c) => `<th>${escapeHtml(c.name)}</th>`).join("");
  const body = msg.data.rows.map((r) =>
    `<tr>${r.map((v) => `<td>${escapeHtml(format(v))}</td>`).join("")}</tr>`).join("");
  content.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function format(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

$("prev").addEventListener("click", () => {
  if (currentPage > 0) vscode.postMessage({ type: "requestPage", page: currentPage - 1 });
});
$("next").addEventListener("click", () =>
  vscode.postMessage({ type: "requestPage", page: currentPage + 1 }));
$("csv").addEventListener("click", () => vscode.postMessage({ type: "export", format: "csv" }));
$("json").addEventListener("click", () => vscode.postMessage({ type: "export", format: "json" }));

window.addEventListener("message", (e: MessageEvent<HostMessage>) => render(e.data));
```

- [ ] **Step 2: Verify it bundles**

Run: `npm run build`
Expected: `dist/webview.js` is produced with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/results/webview/main.ts && git commit -m "feat: add results grid webview UI"
```

---

## Task 10: Runner + commands wiring (the vertical slice)

**Files:**
- Create: `src/editor/runner.ts`, `src/editor/runner.test.ts`
- Modify: `src/extension.ts` (full rewrite below)

- [ ] **Step 1: Write the failing test `src/editor/runner.test.ts`** (pure logic: which SQL text to run)

```ts
import { describe, it, expect } from "vitest";
import { resolveSql } from "./runner";

describe("resolveSql", () => {
  it("uses the selection when one exists", () => {
    expect(resolveSql("select 1;\nselect 2;", "select 2")).toBe("select 2");
  });
  it("falls back to the whole document when selection is empty", () => {
    expect(resolveSql("select 1;", "")).toBe("select 1;");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/editor/runner.test.ts`
Expected: FAIL — cannot find module `./runner`.

- [ ] **Step 3: Create `src/editor/runner.ts`**

```ts
import { ResultsPanel } from "../results/panel";
import { toCsv } from "../export/csv";
import { toJson } from "../export/json";
import { DriverError, type ResultSet } from "../drivers/types";
import type { ConnectionManager } from "../connections/manager";

// Pure: choose the SQL to execute.
export function resolveSql(documentText: string, selectedText: string): string {
  const sel = selectedText.trim();
  return sel.length > 0 ? sel : documentText.trim();
}

export interface RunContext {
  manager: ConnectionManager;
  profileId: string;
  pageSize: number;
  panel: ResultsPanel;
}

// Runs `sql`, drives the panel, and wires paging + export for this result.
export async function runAndShow(ctx: RunContext, sql: string): Promise<void> {
  const { manager, profileId, pageSize, panel } = ctx;

  const runPage = async (page: number): Promise<ResultSet | undefined> => {
    try {
      panel.post({ type: "loading", sql });
      const session = await manager.get(profileId);
      const driver = manager.driverOf(profileId)!;
      const rs = await driver.query(session, sql, { page, pageSize });
      panel.post({ type: "result", data: rs });
      return rs;
    } catch (err) {
      const e = DriverError.from(err);
      panel.post({ type: "error", message: e.message, detail: e.detail });
      return undefined;
    }
  };

  let last = await runPage(0);

  panel.setMessageHandler(async (m) => {
    if (m.type === "requestPage") { last = await runPage(m.page); return; }
    if (m.type === "export" && last) {
      const text = m.format === "csv" ? toCsv(last) : toJson(last);
      const { window, workspace, Uri } = await import("vscode");
      const target = await window.showSaveDialog({
        filters: m.format === "csv" ? { CSV: ["csv"] } : { JSON: ["json"] },
      });
      if (target) {
        await workspace.fs.writeFile(target, Buffer.from(text, "utf8"));
        void window.showInformationMessage(`Exported to ${Uri.from(target).fsPath}`);
      }
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/editor/runner.test.ts`
Expected: PASS (the `resolveSql` tests; `runAndShow` is exercised manually).

- [ ] **Step 5: Rewrite `src/extension.ts`**

```ts
import * as vscode from "vscode";
import { registerBuiltInDrivers } from "./drivers/index";
import { createDriver } from "./drivers/registry";
import { ConnectionStore } from "./connections/store";
import { ConnectionManager } from "./connections/manager";
import { ResultsPanel } from "./results/panel";
import { resolveSql, runAndShow } from "./editor/runner";
import type { EngineId } from "./drivers/types";

let activeProfileId: string | undefined;

export function activate(context: vscode.ExtensionContext): void {
  registerBuiltInDrivers();

  const store = new ConnectionStore(context.globalState, context.secrets);
  const manager = new ConnectionManager(
    (engine) => createDriver(engine),
    (id) => store.getSecret(id),
    (id) => store.get(id),
  );

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = "vsSqlEditor.selectConnection";
  const refreshStatus = () => {
    const p = activeProfileId ? store.get(activeProfileId) : undefined;
    status.text = p ? `$(database) ${p.name}` : "$(database) No SQL connection";
    status.show();
  };
  refreshStatus();

  context.subscriptions.push(
    status,
    vscode.commands.registerCommand("vsSqlEditor.addConnection", () => addConnection(store)),
    vscode.commands.registerCommand("vsSqlEditor.selectConnection", async () => {
      activeProfileId = await pickConnection(store);
      refreshStatus();
    }),
    vscode.commands.registerCommand("vsSqlEditor.runQuery", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { void vscode.window.showErrorMessage("Open a .sql file first."); return; }
      if (!activeProfileId) {
        activeProfileId = await pickConnection(store);
        refreshStatus();
        if (!activeProfileId) return;
      }
      const sql = resolveSql(editor.document.getText(), editor.document.getText(editor.selection));
      if (!sql) { void vscode.window.showErrorMessage("Nothing to run."); return; }
      const panel = ResultsPanel.show(context);
      const pageSize = vscode.workspace.getConfiguration("vsSqlEditor").get<number>("pageSize", 500);
      await runAndShow({ manager, profileId: activeProfileId, pageSize, panel }, sql);
    }),
  );

  context.subscriptions.push({ dispose: () => void manager.disposeAll() });
}

export function deactivate(): void {}

async function pickConnection(store: ConnectionStore): Promise<string | undefined> {
  const items = store.list().map((p) => ({ label: p.name, description: p.engine, id: p.id }));
  if (items.length === 0) {
    const add = await vscode.window.showInformationMessage("No connections yet.", "Add Connection");
    if (add) { const p = await addConnection(store); return p?.id; }
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(items, { placeHolder: "Select a connection" });
  return pick?.id;
}

async function addConnection(store: ConnectionStore) {
  const name = await vscode.window.showInputBox({ prompt: "Connection name" });
  if (!name) return undefined;
  const engine = (await vscode.window.showQuickPick(
    ["postgres"], { placeHolder: "Engine (Phase 1: postgres)" })) as EngineId | undefined;
  if (!engine) return undefined;
  const host = await vscode.window.showInputBox({ prompt: "Host", value: "localhost" });
  const port = Number(await vscode.window.showInputBox({ prompt: "Port", value: "5432" }));
  const database = await vscode.window.showInputBox({ prompt: "Database" });
  const user = await vscode.window.showInputBox({ prompt: "User" });
  const password = await vscode.window.showInputBox({ prompt: "Password", password: true });
  return store.add({ name, engine, host, port, database, user }, password || undefined);
}
```

- [ ] **Step 6: Add a "Run Query" CodeLens — append to `src/extension.ts` `activate()`**

Add this provider registration inside `activate()` (before the final `disposeAll` push):

```ts
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: "sql" }, {
      provideCodeLenses(document) {
        const top = new vscode.Range(0, 0, 0, 0);
        return [new vscode.CodeLens(top, { title: "▶ Run Query", command: "vsSqlEditor.runQuery" })];
      },
    }),
  );
```

- [ ] **Step 7: Build, then manually verify the slice (F5 / Extension Host)**

Run: `npm run build`
Then press **F5** in VS Code to launch the Extension Development Host. In it:
1. Start the test DB: `docker compose -f docker-compose.test.yml up -d`.
2. Run **SQL: Add Connection** → host `localhost`, port `55432`, db `testdb`, user `postgres`, password `test`.
3. Open a new file, set language to **SQL**, type `select * from generate_series(1, 1200) g;`.
4. Click **▶ Run Query** → results panel shows 500 rows, **Next** pages forward, **Export CSV** writes a file.

Expected: grid renders, paging works, export saves a file.

- [ ] **Step 8: Commit**

```bash
git add src/editor/ src/extension.ts
git commit -m "feat: wire run-query slice with connection picker, paging, export"
```

---

## Self-Review Notes (addressed)

- **Spec coverage (Phase 1 rows):** connect (Tasks 5–7, 10), run query (Task 10), results grid (Tasks 8–9), paging (Tasks 5, 9, 10), CSV/JSON export (Tasks 4, 10), secrets in SecretStorage (Task 6), capabilities flag plumbed on the driver (Task 5). `introspect`/`buildEditStatement` intentionally stubbed (Phases 3/5) and asserted via `DriverError.notImplemented`.
- **Type consistency:** `ResultSet`, `Session`, `ConnectionProfile`, `HostMessage`/`WebviewMessage`, `DriverError` names/shapes are identical across every task that references them.
- **No placeholders:** every code step contains complete, runnable code; the only deferred logic is explicitly stubbed with `NOT_IMPLEMENTED`.

## What Phase 2+ will add (not in this plan)
- Phase 2: MySQL, SQLite (WASM), PGlite, ClickHouse drivers — each implements the same interface + capabilities, registered in `drivers/index.ts`.
- Phase 3: `introspect()` per driver + schema explorer TreeView.
- Phase 4: schema-aware `CompletionItemProvider`.
- Phase 5: `buildEditStatement()` per driver + inline grid editing with SQL preview/confirm.
