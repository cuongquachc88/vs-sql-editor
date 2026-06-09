# vs-sql-editor — Design Spec

**Date:** 2026-06-10
**Status:** Approved (design); pending implementation plan
**Form factor:** VS Code extension

## 1. Summary

`vs-sql-editor` is a VS Code extension for connecting to and editing SQL across five
database engines — **PostgreSQL, MySQL, PGlite, SQLite, and ClickHouse** — using VS
Code's native editor as the SQL editing surface. The extension host (Node) owns all
database connections and logic; a sandboxed webview renders the results grid; VS Code's
TreeView powers the schema/connection explorer.

The feature set is grounded in what defines mainstream SQL clients (DBeaver, DataGrip,
TablePlus, Beekeeper Studio): multi-engine connection management, a schema object tree,
a SQL editor with syntax highlighting and schema-aware autocomplete, an editable results
grid, and result export (CSV/JSON). Data *import* is a deliberate future phase.

## 2. v1 Scope

All four are in v1, built in sequence:

1. Connect + run + results grid (the essential vertical slice)
2. Schema explorer TreeView
3. Schema-aware autocomplete
4. Inline result editing + export (CSV/JSON)

Out of scope for v1 (future phases): ER diagrams, query history UI, SQL formatting,
multi-statement scripting/transactions UI, data import, saved queries/snippets.

## 3. Architecture

### Runtime split
- **Extension host (Node):** owns DB connections, drivers, schema introspection, query
  execution, secret storage, command handlers, the TreeView data provider, and the SQL
  completion provider. No DB code runs in a webview.
- **Webview (results panel):** thin UI rendering the results grid, paging controls,
  export buttons, and edit affordances. Communicates with the host only via `postMessage`
  (typed request/response + events). Holds no credentials; issues no queries directly.
- **Native VS Code editor:** plain `.sql` files. A SQL language contribution provides
  highlighting; a `CompletionItemProvider` provides schema-aware autocomplete; CodeLens
  and commands provide "Run" / "Run selection".

### Module layout
```
src/
  drivers/
    types.ts          # DatabaseDriver interface + Capabilities + Schema model
    postgres.ts       # pg
    mysql.ts          # mysql2
    pglite.ts         # @electric-sql/pglite
    sqlite.ts         # @sqlite.org/sqlite-wasm
    clickhouse.ts     # @clickhouse/client
    registry.ts       # engine id -> driver factory
  connections/
    store.ts          # connection profiles (settings) + secrets (SecretStorage)
    manager.ts        # live connection pool, connect/disconnect/dispose
  explorer/
    tree.ts           # TreeDataProvider: connections -> db -> schema -> tables -> columns
  editor/
    completion.ts     # schema-aware CompletionItemProvider
    runner.ts         # resolve active connection, run statement/selection, cancel
  results/
    panel.ts          # webview host: lifecycle + message bridge
    webview/          # grid UI (HTML/TS bundle): render, page, edit, export
  edit/
    diff.ts           # turn grid cell edits -> per-driver UPDATE/INSERT/DELETE
  export/
    csv.ts json.ts    # serialize result sets
  extension.ts        # activate(): register commands, providers, views
```

### The `DatabaseDriver` interface (the spine)
```ts
interface DatabaseDriver {
  readonly capabilities: {
    editRows: boolean;
    cancelQuery: boolean;
    transactions: boolean;
    multipleSchemas: boolean;
  };
  connect(profile, secret): Promise<Session>;
  query(session, sql, opts): Promise<ResultSet>;   // supports paging/limit
  introspect(session): Promise<SchemaModel>;        // dbs/schemas/tables/views/columns + PKs
  buildEditStatement(table, pk, changes): string;   // throws if !editRows
  cancel(session): Promise<void>;
  dispose(session): Promise<void>;
}
```
`capabilities` is how per-engine differences flow to the UI: the grid reads `editRows`
to show/hide editing; the tree reads `multipleSchemas` to nest or flatten; the cancel
button reads `cancelQuery`.

### Engine driver choices (pure-JS / WASM, no native compilation)
- PostgreSQL — `pg`
- MySQL — `mysql2`
- PGlite — `@electric-sql/pglite` (WASM, host-owned, no network)
- SQLite — `@sqlite.org/sqlite-wasm` (avoids native `better-sqlite3` packaging pain on
  VS Code's Electron runtime)
- ClickHouse — `@clickhouse/client` (HTTP-based)

### Connection management & secrets
- Connection **profiles** (name, engine, host/port/db/user, SQLite file path, options)
  live in VS Code settings / global state — **no secrets**.
- **Passwords** go in `context.secrets` (VS Code SecretStorage, OS keychain-backed).
- A "New Connection" command collects fields per-engine via a quick-input flow.
- The active editor↔connection binding is shown in the status bar; running with no
  binding prompts the user to pick a connection.

## 4. Data Flow

### Run a query
1. User triggers "Run" CodeLens / command in a `.sql` file.
2. `runner.ts` resolves the active connection (from the editor↔connection binding;
   prompts to pick if unbound).
3. `manager.ts` returns the live `Session`; `driver.query(session, sql, {limit, offset})`
   executes.
4. Result returns to `results/panel.ts`, which `postMessage`s
   `{columns, rows, page, totalHint, capabilities}` to the webview grid.
5. Grid renders; paging sends `requestPage` to the host, which re-queries with new offset.

### Inline edit
1. Grid is editable only if `capabilities.editRows` **and** the result set maps to a
   single base table with a usable primary key (detected via introspection / result
   metadata).
2. User edits cells → grid sends a `pendingEdits` batch → `edit/diff.ts` calls
   `driver.buildEditStatement` → host shows a **preview of the generated SQL** and asks
   to confirm → executes in a transaction where supported → grid refreshes affected rows.

## 5. Error Handling

- Every driver call is wrapped; failures surface as a normalized
  `{code, message, detail}`. Connection errors mark the tree node disconnected with a
  retry action. Query errors show inline in the results panel (red banner + full
  message) — never a silent failure.
- Long queries: a cancel button calls `driver.cancel` where `capabilities.cancelQuery`
  is true; otherwise the button is disabled with an explanatory tooltip.
- The webview is sandboxed with a strict CSP and a nonce; all host↔webview messages are
  typed and validated.

## 6. Edge Cases

- **ClickHouse / append-only:** `editRows=false` → grid read-only; export still works.
- **SQLite:** single schema → tree flattens; file-path profile instead of host/port; the
  WASM engine loads the file via VS Code's filesystem API.
- **PGlite:** ephemeral / IndexedDB-backed instance owned by the host; first-class
  session with no network.
- **Large result sets:** server-side `LIMIT/OFFSET` paging (default page size 500); the
  webview never loads unbounded results.
- **Multiple statements in one file:** run the statement under the cursor, or the
  selection.

## 7. Testing

- **Unit:** each driver against a real instance via testcontainers (Postgres, MySQL,
  ClickHouse) and in-process (PGlite, SQLite) — covers `query`, `introspect`,
  `buildEditStatement`, capabilities. `diff.ts` and `export` are pure-function unit tests.
- **Integration:** runner + manager + a fake driver, asserting command flow and
  connection binding.
- **Webview:** grid render/paging/edit logic tested headless with the message bridge
  mocked.
- TDD throughout (red → green → refactor).

## 8. Phased Build Order

Each phase ends shippable.

1. **Driver spine + Postgres:** interface, registry, connection profile + secret,
   connect/run, results webview grid with paging + CSV/JSON export.
2. **Remaining engines:** MySQL, SQLite (WASM), PGlite, ClickHouse — each implements the
   interface + capabilities.
3. **Schema explorer TreeView:** introspection-driven, table preview on click.
4. **Schema-aware autocomplete:** completion provider fed by cached introspection.
5. **Inline result editing:** capability-gated, SQL preview + confirm, transactional
   refresh.
