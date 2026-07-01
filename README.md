# VS SQL Editor

A full-featured SQL client built into VS Code — connect to **PostgreSQL, MySQL, SQLite, PGlite, and ClickHouse**, run queries, browse your schema, edit rows inline, import CSV files, and generate SQL with AI.

## Features

### Multi-engine database connections
Connect to any supported engine with a single form. Passwords are stored in VS Code's OS keychain (SecretStorage) — never in plain text.

| Engine | Notes |
|--------|-------|
| **PostgreSQL** | Full SSL/TLS support (disable / require / verify-ca / verify-full) |
| **MySQL** | SSL support, row editing |
| **SQLite** | Local `.db` / `.sqlite` file |
| **PGlite** | In-process Postgres (WASM) — no server required |
| **ClickHouse** | HTTP/HTTPS, `http://` and `https://` auto-selects port |

### Query editor
- Run queries with **F5** or **Cmd+Enter** — works on the full file or just your selection
- **Multi-statement** support: split on `;` and run each statement independently
- **Schema-aware autocomplete** — tables, columns, and aliases as you type
- **AI — Ask in plain English**: describe what you want, get SQL inserted at your cursor
- **AI — Explain Query**: get a natural-language explanation of any SQL
- **AI — Suggest Fix**: automatically suggests a fix when a query fails

### Results grid
- Paginated results with **Prev / Next** page controls
- **Type chips** on every column header (int4, text, timestamptz…)
- **NULL pill** — visually distinct from empty strings
- **Find / filter** within the current page
- **Export CSV or JSON** from any result

### Inline row editing
When you preview a table that has a primary key (PostgreSQL, MySQL, SQLite), cells become editable. Edit a value, click away, review the generated `UPDATE` statement, and confirm to apply.

### Schema explorer
Browse databases → schemas → tables → columns in the sidebar. Click any table to preview its first page of data.

### ERD Diagram
Visualize your schema as an entity-relationship diagram with draggable nodes and foreign-key lines.

### CSV Import
Drop a CSV file into the import panel, preview column types (auto-inferred), adjust names and types, pick a target table, and import — creates the table if it doesn't exist.

### SQL Notebook
Use `.sqlnb` files as literate SQL notebooks — cells run against your active connection, results render inline.

### Table Designer
Visual CREATE TABLE / ALTER TABLE editor with column types, primary keys, foreign keys, indexes, and check constraints. Generates the exact DDL diff for ALTER operations.

---

## Getting Started

1. Open the **SQL Editor** panel in the activity bar (database icon).
2. Click **Add Connection** and fill in the form for your engine.
3. Open or create a `.sql` file.
4. Press **F5** or **Cmd+Enter** to run.

---

## AI Features

AI features work with:
- **VS Code Language Model API** (e.g. GitHub Copilot) — auto-detected
- **OpenAI-compatible API** — run **SQL: AI — Set OpenAI API Key** to configure

Set the provider in Settings → VS SQL Editor → AI Provider.

---

## Requirements

- VS Code **1.90** or later
- Node.js is **not** required for SQLite and PGlite (both run as WASM in-process)
- For PostgreSQL / MySQL / ClickHouse: network access to your database server

---

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `vsSqlEditor.pageSize` | `500` | Rows per results page |
| `vsSqlEditor.ai.provider` | `"auto"` | `"auto"` / `"vscode-lm"` / `"openai"` |
| `vsSqlEditor.ai.openai.baseUrl` | `https://api.openai.com/v1` | OpenAI-compatible endpoint |
| `vsSqlEditor.ai.openai.model` | `"gpt-4o-mini"` | Model name |
| `vsSqlEditor.ai.inline.enabled` | `true` | Schema-aware ghost completions in SQL files |

---

## Privacy

VS SQL Editor collects **no data** and has **no telemetry**. The only network traffic is the database connections you explicitly configure. Passwords are stored in VS Code's OS keychain. Full details in [PRIVACY.md](PRIVACY.md).

---

## License

[MIT](LICENSE) — © cuongquachc88
