# vs-sql-editor

A VS Code extension to connect to and edit SQL across **PostgreSQL, MySQL, PGlite,
SQLite, and ClickHouse** — using VS Code's native editor as the SQL surface.

> **Status:** Phases 1–2 done. All five engines (PostgreSQL, MySQL, SQLite, PGlite,
> ClickHouse) can connect → run → page results → export CSV/JSON. Schema explorer,
> autocomplete, and inline editing land in Phases 3–5 — see the plans under
> `docs/superpowers/plans/`.

## Install

**From a packaged `.vsix` (recommended):**

1. Download `vs-sql-editor-<version>.vsix` from the
   [GitHub Releases](https://github.com/cuongquachc88/vs-sql-editor/releases) page.
2. Install it:
   ```powershell
   code --install-extension vs-sql-editor-0.0.1.vsix
   ```
   Or in VS Code: **Ctrl+Shift+P → Extensions: Install from VSIX…** and pick the file.
3. Reload VS Code.

**Build and install from source:**

```powershell
git clone https://github.com/cuongquachc88/vs-sql-editor.git
cd vs-sql-editor
npm install
npx @vscode/vsce package
code --install-extension vs-sql-editor-0.0.1.vsix
```

## Architecture

The extension host (Node) owns all database connections behind a single
`DatabaseDriver` interface; a sandboxed webview renders the results grid and talks to
the host only via typed `postMessage`. See
`docs/superpowers/specs/2026-06-10-vs-sql-editor-design.md` for the full design.

```
src/
  drivers/        DatabaseDriver interface, registry, per-engine drivers (Postgres now)
  connections/    profile + secret storage, live session manager
  results/        webview host + protocol + grid UI
  editor/         run-query logic, export wiring
  export/         CSV / JSON serializers
  extension.ts    activate(): commands, status bar, CodeLens
```

## Develop

```bash
npm install
npm run build        # bundles dist/extension.js + dist/webview.js
npm test             # unit tests (vitest)
npm run watch        # rebuild on change
```

Press **F5** in VS Code to launch the Extension Development Host.

### Using it

1. **SQL: Add Connection** — pick an engine:
   - **postgres / mysql / clickhouse:** host / port / database / user / password
     (password stored in VS Code SecretStorage, OS-keychain backed).
   - **sqlite:** path to a `.sqlite` file.
   - **pglite:** optional data directory (blank = in-memory).
2. Open a `.sql` file, write a query.
3. Click **▶ Run Query** (CodeLens) or run **SQL: Run Query**.
4. Results appear in a side panel: page with **Prev/Next**, export with **CSV/JSON**.
   (ClickHouse is read-only/append-oriented, so inline editing — Phase 5 — will stay off
   for it via the driver's `capabilities.editRows = false`.)

## Testing

SQLite and PGlite run fully in-process (WASM), so their driver tests always run with
`npm test` — no services needed. Postgres, MySQL, and ClickHouse have integration tests
gated on env vars; to run them:

```powershell
docker compose -f docker-compose.test.yml up -d
$env:TEST_PG_URL="postgres://postgres:test@localhost:55432/testdb"
$env:TEST_MYSQL_URL="mysql://root:test@localhost:53306/testdb"
$env:TEST_CLICKHOUSE_URL="http://default:@localhost:58123/default"
npm test
docker compose -f docker-compose.test.yml down
```

## Development

See [`DEVELOPMENT.md`](DEVELOPMENT.md) for build, debug (F5), packaging, and how to add a
new database engine.

## Privacy

VS SQL Editor collects **no data**, has **no telemetry**, and sends nothing to any
third-party server. Connection profiles are stored locally and passwords are kept in VS
Code's OS-keychain-backed SecretStorage. Full details: [`PRIVACY.md`](PRIVACY.md).

## Support

Questions, bugs, or feature requests:
[open an issue](https://github.com/cuongquachc88/vs-sql-editor/issues) or email
[cuongquachc88@gmail.com](mailto:cuongquachc88@gmail.com).

## License

[MIT](LICENSE)
