# Development Guide — VS SQL Editor

How to build, test, debug, and package the extension.

## Prerequisites

- **Node.js 20+** and npm
- **VS Code 1.90+**
- (Optional) **Docker** — only to run the Postgres / MySQL / ClickHouse integration tests

## Setup

```powershell
git clone <your-repo-url>
cd vs-sql-editor
npm install
```

## Common scripts

| Command | What it does |
|---------|--------------|
| `npm run build` | Bundle `dist/extension.js` (host) and `dist/webview.js` (results grid) via esbuild |
| `npm run watch` | Rebuild on change |
| `npm test` | Run the vitest unit suite |
| `npm run vscode:prepublish` | Production build (run automatically by `vsce package`) |

## Run / debug in VS Code

1. Open the folder in VS Code.
2. Press **F5** (Run → Start Debugging). This runs the `npm: build` task, then launches an
   **Extension Development Host** window with the extension loaded.
3. In that window: **SQL: Add Connection** → run a query from a `.sql` file.

`.vscode/launch.json` and `.vscode/tasks.json` are already configured for this.

## Testing

- **Unit tests** run with no external services. SQLite (`sql.js`) and PGlite run fully
  in-process (WASM), so their driver tests execute on every `npm test`.
- The `vscode` module is stubbed for tests via `test/vscode-mock.ts` (aliased in
  `vitest.config.ts`).
- **Integration tests** for Postgres / MySQL / ClickHouse are gated on env vars and skip
  when unset. To run them, start the test databases and set the URLs:

  ```powershell
  docker compose -f docker-compose.test.yml up -d
  $env:TEST_PG_URL="postgres://postgres:test@localhost:55432/testdb"
  $env:TEST_MYSQL_URL="mysql://root:test@localhost:53306/testdb"
  $env:TEST_CLICKHOUSE_URL="http://default:@localhost:58123/default"
  npm test
  docker compose -f docker-compose.test.yml down
  ```

## Packaging a .vsix

```powershell
npx @vscode/vsce package
# produces vs-sql-editor-<version>.vsix
code --install-extension vs-sql-editor-0.0.1.vsix
```

### Why dependencies are external (not bundled)

`esbuild.mjs` sets `packages: "external"` for the extension host. WASM-backed libraries
(`@electric-sql/pglite`, `sql.js`) load their `.wasm`/asset files from `node_modules` at
runtime, and PGlite is ESM-only (loaded via a dynamic `import()` so a CJS bundle can reach
it). Bundling would break that asset resolution, so the production dependencies ship inside
the `.vsix` (dev dependencies and type defs are excluded via `.vscodeignore`).

## Architecture

The extension host (Node) owns all DB connections behind one `DatabaseDriver` interface
(`src/drivers/types.ts`); a sandboxed webview renders the results grid and communicates
only via typed `postMessage`. See the full design in
`docs/superpowers/specs/2026-06-10-vs-sql-editor-design.md` and the phased plans in
`docs/superpowers/plans/`.

```
src/
  drivers/        DatabaseDriver interface, registry, paging helper, per-engine drivers
  connections/    profile + secret storage, live session manager
  results/        webview host + message protocol + grid UI
  editor/         run-query logic + export wiring
  export/         CSV / JSON serializers
  extension.ts    activate(): commands, status bar, CodeLens, Add Connection flow
```

### Adding a new engine

1. Create `src/drivers/<engine>.ts` implementing `DatabaseDriver` (set `capabilities`).
2. Register it in `src/drivers/index.ts`.
3. Add it to the engine picker / field flow in `src/extension.ts`.
4. Add a driver test (in-process → always-on; networked → env-gated).

## Support

Questions or bugs: **cuongquachc88@gmail.com**
