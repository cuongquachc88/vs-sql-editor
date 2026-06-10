# vs-sql-editor

A VS Code extension to connect to and edit SQL across **PostgreSQL, MySQL, PGlite,
SQLite, and ClickHouse** — using VS Code's native editor as the SQL surface.

> **Status:** Phase 1 (PostgreSQL: connect → run → paged results grid → CSV/JSON export).
> Remaining engines and features land in later phases — see
> [`docs/superpowers/plans/`](docs/superpowers/plans/).

## Architecture

The extension host (Node) owns all database connections behind a single
`DatabaseDriver` interface; a sandboxed webview renders the results grid and talks to
the host only via typed `postMessage`. See
[`docs/superpowers/specs/2026-06-10-vs-sql-editor-design.md`](docs/superpowers/specs/2026-06-10-vs-sql-editor-design.md)
for the full design.

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

### Using it (Phase 1)

1. **SQL: Add Connection** — enter Postgres host/port/db/user/password (password is stored
   in VS Code SecretStorage, OS-keychain backed).
2. Open a `.sql` file, write a query.
3. Click **▶ Run Query** (CodeLens) or run **SQL: Run Query**.
4. Results appear in a side panel: page with **Prev/Next**, export with **CSV/JSON**.

## Testing

Unit tests run with no external services. The Postgres driver has an integration test
gated on `TEST_PG_URL`; to run it:

```bash
docker compose -f docker-compose.test.yml up -d
$env:TEST_PG_URL="postgres://postgres:test@localhost:55432/testdb"   # PowerShell
npm test
docker compose -f docker-compose.test.yml down
```
