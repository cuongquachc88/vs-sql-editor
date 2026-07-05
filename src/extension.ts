import * as vscode from "vscode";
import { registerBuiltInDrivers } from "./drivers/index";
import { createDriver } from "./drivers/registry";
import { ConnectionStore } from "./connections/store";
import { ConnectionManager } from "./connections/manager";
import { ResultsPanel } from "./results/panel";
import { resolveSql, runAndShow } from "./editor/runner";
import { splitSqlStatements } from "./editor/sql-split";
import { createSqlCompletionProvider } from "./editor/completion";
import { SchemaCache } from "./connections/schema-cache";
import { ConnectionFormPanel } from "./connections/form/panel";
import { ConnectionsViewProvider } from "./connections/sidebar/provider";
import { qualifyTable } from "./connections/qualify";
import { quoteIdent } from "./import/sql-types";
import { TableDesignerPanel } from "./table-designer/panel";
import { RecentQueries } from "./connections/recent-queries";
import { SavedQueries } from "./connections/saved-queries";
import { HistoryViewProvider } from "./history/provider";
import { WelcomePanel } from "./welcome/panel";
import { ErdPanel } from "./erd/panel";
import { CsvImportPanel } from "./import/panel";
import { aiAskSql } from "./ai/nl-to-sql";
import { aiExplain } from "./ai/explain";
import { aiSuggestFix, recordLastError } from "./ai/fix-on-error";
import { createInlineCompletionProvider } from "./ai/inline-completions";
import { setOpenAiKey } from "./ai/settings";
import { SqlNotebookSerializer } from "./notebook/serializer";
import { SqlNotebookController, NOTEBOOK_TYPE } from "./notebook/controller";
import type { EngineId } from "./drivers/types";

const ACTIVE_KEY = "vsSqlEditor.activeProfileId";
const WELCOME_SHOWN_KEY = "vsSqlEditor.welcomeShown";

export function activate(context: vscode.ExtensionContext): void {
  try {
    activateImpl(context);
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    const stack = (err as Error)?.stack ?? "";
    // Loud and unmissable so we never silently fail activation again.
    void vscode.window.showErrorMessage(
      `VS SQL Editor failed to activate: ${msg}`,
      "Open Log",
    ).then((choice) => {
      if (choice === "Open Log") {
        const out = vscode.window.createOutputChannel("VS SQL Editor");
        out.appendLine(`Activation error: ${msg}`);
        out.appendLine(stack);
        out.show(true);
      }
    });
    throw err; // also bubble up to VS Code's extension host log
  }
}

function activateImpl(context: vscode.ExtensionContext): void {
  registerBuiltInDrivers();

  const store = new ConnectionStore(context.globalState, context.secrets);
  const recents = new RecentQueries(context.globalState);
  const savedQueries = new SavedQueries(context.globalState);
  const manager = new ConnectionManager(
    (engine) => createDriver(engine),
    (id) => store.getSecret(id),
    (id) => store.get(id),
  );

  let activeProfileId: string | undefined = context.globalState.get<string>(ACTIVE_KEY);
  if (activeProfileId && !store.get(activeProfileId)) activeProfileId = undefined;

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = "vsSqlEditor.selectConnection";
  const refreshStatus = () => {
    const p = activeProfileId ? store.get(activeProfileId) : undefined;
    status.text = p ? `$(database) ${p.name}` : "$(database) No SQL connection";
    status.show();
  };
  refreshStatus();

  // Forward declaration — closures reference this; the provider is
  // constructed later.
  let sidebar: ConnectionsViewProvider;

  const schemaCache = new SchemaCache(async (profileId) => {
    const session = await manager.get(profileId);
    const driver = manager.driverOf(profileId)!;
    return driver.introspect(session);
  });

  const previewPageSize = () =>
    vscode.workspace.getConfiguration("vsSqlEditor").get<number>("pageSize", 500);

  const openForm = (mode: "add" | "edit" | "duplicate", profileId?: string) => {
    const profile = profileId ? store.get(profileId) : undefined;
    ConnectionFormPanel.show(
      context,
      {
        store,
        onSaved: (saved) => {
          if (mode === "edit" && saved.id === activeProfileId) {
            void manager.disconnect(saved.id);
          }
          sidebar.refresh();
        },
      },
      { mode, source: profile },
    );
  };

  const setActive = async (id: string | undefined) => {
    activeProfileId = id;
    await context.globalState.update(ACTIVE_KEY, id);
    refreshStatus();
    sidebar.postActiveChanged();
    notebookController?.refreshLabel();
  };

  const previewTable = async (
    profileId: string,
    database: string,
    schema: string,
    table: string,
    isView: boolean,
  ) => {
    const profile = store.get(profileId);
    if (!profile) return;
    const ref = qualifyTable(profile.engine, schema, table);
    const panel = await openResultsBelow(context);
    await setActive(profileId);

    let edit: { table: string; pkColumns: string[] } | undefined;
    const driver = manager.driverOf(profileId);
    const pk = isView
      ? []
      : (schemaCache
          .peek(profileId)
          ?.databases.find((d) => d.name === database)
          ?.schemas.find((s) => s.name === schema)
          ?.tables.find((t) => t.name === table)?.primaryKey ?? []);
    if (driver?.capabilities.editRows && pk.length > 0) {
      edit = { table: ref, pkColumns: pk };
    }
    await runAndShow(
      {
        manager,
        profileId,
        pageSize: previewPageSize(),
        panel,
        edit,
        connectionLabel: profile.name,
        onQueryCompleted: ({ sql, ok }) => {
          void recents.add({
            profileId,
            profileName: profile.name,
            sql,
            at: Date.now(),
            ok,
          });
          sidebar.postLiveChanged();
        },
        onQueryError: ({ sql, errorMessage }) => recordLastError(sql, errorMessage),
      },
      `select * from ${ref}`,
    );
  };

  const deleteConnection = async (profileId: string) => {
    const profile = store.get(profileId);
    if (!profile) return;
    const choice = await vscode.window.showWarningMessage(
      `Delete connection "${profile.name}"? This cannot be undone.`,
      { modal: true },
      "Delete",
    );
    if (choice !== "Delete") return;
    await manager.disconnect(profile.id);
    await store.remove(profile.id);
    if (activeProfileId === profile.id) await setActive(undefined);
    sidebar.refresh();
  };

  // Engine-aware DDL helpers used by the right-click create/drop menu.
  const runDdl = async (profileId: string, sql: string): Promise<boolean> => {
    try {
      const session = await manager.get(profileId);
      const driver = manager.driverOf(profileId);
      if (!driver) throw new Error("Driver not available");
      await driver.query(session, sql);
      sidebar.refresh();
      sidebar.postLiveChanged();
      return true;
    } catch (err) {
      void vscode.window.showErrorMessage(`SQL failed: ${(err as Error).message}`);
      return false;
    }
  };

  const createDatabase = async (profileId: string) => {
    const profile = store.get(profileId);
    if (!profile) return;
    if (profile.engine === "sqlite" || profile.engine === "pglite") {
      void vscode.window.showInformationMessage(
        `${profile.engine}: a database is a single file. Add a new connection with a different file path instead.`,
      );
      return;
    }
    const name = await vscode.window.showInputBox({
      prompt: `Create database (${profile.engine})`,
      placeHolder: "my_db",
      validateInput: (v) =>
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(v) ? undefined : "Use letters/digits/underscore; start with a letter.",
    });
    if (!name) return;
    const sql = `CREATE DATABASE ${quoteIdent(profile.engine, name)}`;
    await runDdl(profileId, sql);
  };

  const createSchema = async (profileId: string, _database: string) => {
    void _database;
    const profile = store.get(profileId);
    if (!profile) return;
    if (profile.engine === "sqlite" || profile.engine === "mysql") {
      void vscode.window.showInformationMessage(
        `${profile.engine}: schemas aren't a separate concept here. ` +
          (profile.engine === "mysql" ? "Use Create Database instead." : ""),
      );
      return;
    }
    const name = await vscode.window.showInputBox({
      prompt: `Create schema (${profile.engine})`,
      placeHolder: "my_schema",
      validateInput: (v) =>
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(v) ? undefined : "Use letters/digits/underscore; start with a letter.",
    });
    if (!name) return;
    const sql = `CREATE SCHEMA ${quoteIdent(profile.engine, name)}`;
    await runDdl(profileId, sql);
  };

  const createTable = async (profileId: string, _database: string, schema: string) => {
    void _database;
    TableDesignerPanel.show(
      context,
      {
        store,
        manager,
        schemaCache,
        onSaved: () => sidebar.refresh(),
      },
      { mode: "create", profileId, preferredSchema: schema },
    );
  };

  const editTable = async (
    profileId: string,
    _database: string,
    schema: string,
    table: string,
  ) => {
    void _database;
    TableDesignerPanel.show(
      context,
      {
        store,
        manager,
        schemaCache,
        onSaved: () => sidebar.refresh(),
      },
      { mode: "edit", profileId, schema, table },
    );
  };

  const dropTable = async (
    profileId: string,
    _database: string,
    schema: string,
    table: string,
    isView: boolean,
  ) => {
    void _database;
    const profile = store.get(profileId);
    if (!profile) return;
    const what = isView ? "view" : "table";
    const choice = await vscode.window.showWarningMessage(
      `Drop ${what} "${schema}.${table}"? This cannot be undone.`,
      { modal: true },
      "Drop",
    );
    if (choice !== "Drop") return;
    const ref = qualifyTable(profile.engine, schema, table);
    const sql = `DROP ${what.toUpperCase()} ${ref}`;
    await runDdl(profileId, sql);
  };

  sidebar = new ConnectionsViewProvider(context, store, schemaCache, {
    getActiveProfileId: () => activeProfileId,
    getLiveProfileIds: () => manager.liveProfileIds(),
    onAddConnection: () => openForm("add"),
    onNewQuery: async (id) => {
      if (id && id !== activeProfileId) await setActive(id);
      await vscode.commands.executeCommand("vsSqlEditor.newQuery");
    },
    onSetActive: (id) => setActive(id),
    onEdit: (id) => openForm("edit", id),
    onDuplicate: (id) => openForm("duplicate", id),
    onDelete: (id) => deleteConnection(id),
    onPreviewTable: (id, db, sc, t, isView) => previewTable(id, db, sc, t, isView),
    onCreateDatabase: (id) => createDatabase(id),
    onCreateSchema: (id, db) => createSchema(id, db),
    onCreateTable: (id, db, sc) => createTable(id, db, sc),
    onEditTable: (id, db, sc, t) => editTable(id, db, sc, t),
    onDropTable: (id, db, sc, t, isView) => dropTable(id, db, sc, t, isView),
  });

  const completionProvider = vscode.languages.registerCompletionItemProvider(
    { language: "sql" },
    createSqlCompletionProvider(() => activeProfileId, schemaCache),
    ".",
    " ",
  );

  const openWelcome = () =>
    WelcomePanel.show(context, store, recents, {
      getActiveProfileId: () => activeProfileId,
      onAddConnection: () => openForm("add"),
      onOpenConnection: async (id) => {
        await setActive(id);
        await vscode.commands.executeCommand("vsSqlEditorConnections.focus");
      },
      onOpenQuery: async (sql, profileId) => {
        if (profileId && profileId !== activeProfileId) await setActive(profileId);
        const doc = await vscode.workspace.openTextDocument({ language: "sql", content: sql });
        await vscode.window.showTextDocument(doc);
      },
      onOpenSample: async (engine) => {
        const sql = sampleQuery(engine);
        const doc = await vscode.workspace.openTextDocument({ language: "sql", content: sql });
        await vscode.window.showTextDocument(doc);
      },
    });

  // Auto-open the welcome panel on first activation.
  if (!context.globalState.get<boolean>(WELCOME_SHOWN_KEY)) {
    void context.globalState.update(WELCOME_SHOWN_KEY, true);
    openWelcome();
  }

  const notebookSerializer = vscode.workspace.registerNotebookSerializer(
    NOTEBOOK_TYPE,
    new SqlNotebookSerializer(),
    { transientOutputs: true },
  );
  const notebookController = new SqlNotebookController(
    context,
    store,
    manager,
    () => activeProfileId,
    async (id) => {
      await setActive(id);
    },
    () => previewPageSize(),
    () => sidebar.postLiveChanged(),
  );

  // Register commands FIRST in their own subscriptions push so a failure in
  // any later infrastructure (webview view, notebook controller, etc.) cannot
  // prevent the commands from being available.
  context.subscriptions.push(
    vscode.commands.registerCommand("vsSqlEditor.welcome", () => openWelcome()),
    vscode.commands.registerCommand("vsSqlEditor.newQuery", async (sql?: string) => {
      const profile = activeProfileId ? store.get(activeProfileId) : undefined;
      const seed =
        typeof sql === "string"
          ? sql
          : profile
            ? `-- Active connection: ${profile.name} (${profile.engine})\n-- Click ▶ Run Query above (or press F5).\n\nselect 1 as hello;\n`
            : `-- No active connection. Pick one from the SQL Editor sidebar first.\n\nselect 1 as hello;\n`;

      // Just open the .sql file — results panel opens later when the user
      // clicks ▶ Run Query (so they don't get an empty result pane up front).
      const doc = await vscode.workspace.openTextDocument({ language: "sql", content: seed });
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    }),
    vscode.commands.registerCommand("vsSqlEditor.openErd", async () => {
      if (!activeProfileId) {
        const choice = await vscode.window.showInformationMessage(
          "No active SQL connection. Pick one from the SQL Editor view.",
          "Open View",
        );
        if (choice === "Open View") {
          await vscode.commands.executeCommand("vsSqlEditorConnections.focus");
        }
        return;
      }
      ErdPanel.show(context, store, schemaCache, activeProfileId, {
        onOpenTable: (pid, db, sc, t, isView) => previewTable(pid, db, sc, t, isView),
      });
    }),
    vscode.commands.registerCommand("vsSqlEditor.aiAskSql", () =>
      aiAskSql(context, store, schemaCache, activeProfileId),
    ),
    vscode.commands.registerCommand("vsSqlEditor.aiExplain", () =>
      aiExplain(context, store, schemaCache, activeProfileId),
    ),
    vscode.commands.registerCommand("vsSqlEditor.aiSuggestFix", () =>
      aiSuggestFix(context, store, schemaCache, activeProfileId),
    ),
    vscode.commands.registerCommand("vsSqlEditor.aiSetOpenAiKey", async () => {
      const key = await vscode.window.showInputBox({
        prompt: "Enter your OpenAI-compatible API key",
        password: true,
        ignoreFocusOut: true,
      });
      if (!key) return;
      await setOpenAiKey(context.secrets, key);
      void vscode.window.showInformationMessage("OpenAI API key saved.");
    }),
    vscode.languages.registerInlineCompletionItemProvider(
      { language: "sql" },
      createInlineCompletionProvider(context, store, schemaCache, () => activeProfileId),
    ),
    vscode.commands.registerCommand("vsSqlEditor.importCsv", async () => {
      if (!activeProfileId) {
        const choice = await vscode.window.showInformationMessage(
          "No active SQL connection. Pick one from the SQL Editor view.",
          "Open View",
        );
        if (choice === "Open View") {
          await vscode.commands.executeCommand("vsSqlEditorConnections.focus");
        }
        return;
      }
      CsvImportPanel.show(
        context,
        store,
        manager,
        schemaCache,
        activeProfileId,
        () => sidebar.refresh(),
      );
    }),
    vscode.commands.registerCommand("vsSqlEditor.addConnection", () => openForm("add")),
    vscode.commands.registerCommand("vsSqlEditor.editConnection", (id?: string) => {
      if (id) openForm("edit", id);
    }),
    vscode.commands.registerCommand("vsSqlEditor.duplicateConnection", (id?: string) => {
      if (id) openForm("duplicate", id);
    }),
    vscode.commands.registerCommand("vsSqlEditor.deleteConnection", async (id?: string) => {
      if (id) await deleteConnection(id);
    }),
    vscode.commands.registerCommand("vsSqlEditor.setActiveConnection", async (id?: string) => {
      if (id) await setActive(id);
    }),
    vscode.commands.registerCommand("vsSqlEditor.refreshExplorer", () => sidebar.refresh()),
    vscode.commands.registerCommand("vsSqlEditor.previewTable", () => {
      // Hidden from palette; the sidebar webview invokes previewTable directly.
    }),
    vscode.commands.registerCommand("vsSqlEditor.selectConnection", async () => {
      const choice = await vscode.window.showInformationMessage(
        activeProfileId
          ? "Right-click a connection in the SQL Editor view to change the active one."
          : "Pick a connection from the SQL Editor view.",
        "Open View",
      );
      if (choice === "Open View") {
        await vscode.commands.executeCommand("vsSqlEditorConnections.focus");
      }
    }),
    vscode.commands.registerCommand("vsSqlEditor.runAll", () =>
      vscode.commands.executeCommand("vsSqlEditor.runQuery", { mode: "all" }),
    ),
    vscode.commands.registerCommand("vsSqlEditor.runSelected", () =>
      vscode.commands.executeCommand("vsSqlEditor.runQuery", { mode: "selected" }),
    ),
    vscode.commands.registerCommand("vsSqlEditor.runQuery", async (opts?: { mode?: "all" | "selected" }) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showErrorMessage("Open a .sql file first.");
        return;
      }
      if (!activeProfileId) {
        const choice = await vscode.window.showInformationMessage(
          "No active SQL connection. Pick one from the SQL Editor view.",
          "Open View",
        );
        if (choice === "Open View") {
          await vscode.commands.executeCommand("vsSqlEditorConnections.focus");
        }
        return;
      }
      const docText = editor.document.getText();
      const selText = editor.document.getText(editor.selection);
      const sqlText =
        opts?.mode === "all"
          ? docText.trim()
          : opts?.mode === "selected"
            ? selText.trim() || docText.trim()
            : resolveSql(docText, selText);
      if (!sqlText) {
        void vscode.window.showErrorMessage("Nothing to run.");
        return;
      }
      const pageSize = vscode.workspace
        .getConfiguration("vsSqlEditor")
        .get<number>("pageSize", 500);
      const profileName = store.get(activeProfileId)?.name;

      // Split the SQL into individual statements. Each statement gets its own
      // results panel tab so the user can see all results side-by-side.
      const statements = splitSqlStatements(sqlText);
      if (statements.length === 0) {
        void vscode.window.showErrorMessage("Nothing to run.");
        return;
      }

      // Single statement → reuse the singleton "SQL Results" panel (back-compat).
      if (statements.length === 1) {
        const panel = await openResultsBelow(context);
        await runAndShow(
          {
            manager,
            profileId: activeProfileId,
            pageSize,
            panel,
            connectionLabel: profileName,
            onQueryCompleted: ({ sql, ok }) => {
              if (!activeProfileId) return;
              void recents.add({
                profileId: activeProfileId,
                profileName: profileName ?? "—",
                sql,
                at: Date.now(),
                ok,
              });
              sidebar.postLiveChanged();
              historyPanel.refresh();
            },
            onQueryError: ({ sql, errorMessage }) => recordLastError(sql, errorMessage),
            onSaveQuery: async ({ sql }) => {
              const name = await vscode.window.showInputBox({
                prompt: "Save query as…",
                placeHolder: "My query name",
                value: sql.split("\n")[0].replace(/^--\s*/, "").slice(0, 60) || "Untitled query",
              });
              if (!name) return;
              await savedQueries.save({ name, sql, profileId: activeProfileId, profileName });
              historyPanel.refresh();
            },
          },
          statements[0],
        );
        return;
      }

      // Multiple statements → one panel per statement, opened beside the editor.
      // First one goes through openResultsBelow to set up the top/bottom layout
      // (reusing the singleton); subsequent ones are fresh panels in the same
      // group so they appear as tabs.
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        const title = `SQL Results (${i + 1}/${statements.length})`;
        const panel =
          i === 0
            ? await openResultsBelow(context)
            : ResultsPanel.createNew(context, vscode.ViewColumn.Beside, title);
        await runAndShow(
          {
            manager,
            profileId: activeProfileId,
            pageSize,
            panel,
            connectionLabel: `${profileName ?? "—"} · ${title}`,
            onQueryCompleted: ({ sql, ok }) => {
              if (!activeProfileId) return;
              void recents.add({
                profileId: activeProfileId,
                profileName: profileName ?? "—",
                sql,
                at: Date.now(),
                ok,
              });
              sidebar.postLiveChanged();
            },
            onQueryError: ({ sql, errorMessage }) => recordLastError(sql, errorMessage),
          },
          stmt,
        );
      }
    }),
    (() => {
      const emitter = new vscode.EventEmitter<void>();
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (e.textEditor.document.languageId === "sql") emitter.fire();
      });
      return vscode.languages.registerCodeLensProvider(
        { language: "sql" },
        {
          onDidChangeCodeLenses: emitter.event,
          provideCodeLenses(document) {
            const top = new vscode.Range(0, 0, 0, 0);
            const editor = vscode.window.activeTextEditor;
            const hasSelection =
              editor &&
              editor.document.uri.toString() === document.uri.toString() &&
              !editor.selection.isEmpty;
            // Single lens per button with non-breaking spaces between icon
            // and text so the spacing reads visually (regular spaces are
            // collapsed by CodeLens text rendering).
            const NBSP = " ";
            // Extra NBSP after each codicon so icon and label have visible
            // breathing room (regular space gets collapsed by the renderer).
            const lenses: vscode.CodeLens[] = [
              new vscode.CodeLens(top, {
                title: `$(debug-start)${NBSP} Run All · F5`,
                command: "vsSqlEditor.runAll",
                tooltip: "Run All (F5)",
              }),
            ];
            if (hasSelection) {
              lenses.push(
                new vscode.CodeLens(top, {
                  title: `$(run-below)${NBSP} Run Selection · ⌘↵`,
                  command: "vsSqlEditor.runSelected",
                  tooltip: "Run Selection (⌘↵)",
                }),
              );
            }
            return lenses;
          },
        },
      );
    })(),
  );

  const historyPanel = new HistoryViewProvider(
    recents,
    savedQueries,
    {
      onOpenQuery: async (sql, profileId) => {
        if (profileId && profileId !== activeProfileId) await setActive(profileId);
        const doc = await vscode.workspace.openTextDocument({ language: "sql", content: sql });
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
      },
      onSaveQuery: async (_id, name, sql, profileId, profileName) => {
        await savedQueries.save({ name, sql, profileId, profileName });
        historyPanel.refresh();
      },
      onDeleteSaved: async (id) => {
        await savedQueries.remove(id);
      },
      onClearHistory: async () => {
        await recents.clear();
        historyPanel.refresh();
      },
    },
  );

  // Infrastructure subscriptions. Pushed separately so even if any of these
  // throw, the commands above are still registered and usable.
  context.subscriptions.push(
    status,
    completionProvider,
    notebookSerializer,
    vscode.window.registerWebviewViewProvider(ConnectionsViewProvider.viewType, sidebar),
    vscode.window.registerWebviewViewProvider(HistoryViewProvider.viewType, historyPanel),
  );

  context.subscriptions.push({ dispose: () => void manager.disposeAll() });
}

export function deactivate(): void {}

// Opens the results panel in a second editor group below the editor. Only
// arranges the layout on FIRST open (subsequent calls just reveal the existing
// panel without re-arranging — avoids flicker and preserves the user's manual
// resizing of the divider).
async function openResultsBelow(
  context: vscode.ExtensionContext,
): Promise<ReturnType<typeof ResultsPanel.show>> {
  const fresh = !ResultsPanel.isOpen();
  const panel = ResultsPanel.show(context, vscode.ViewColumn.Beside);
  if (fresh) {
    // Wait one tick so the new group exists before we rearrange.
    await new Promise<void>((r) => setTimeout(r, 30));
    await vscode.commands.executeCommand("workbench.action.editorLayoutTwoRows");
    await vscode.commands.executeCommand("workbench.action.focusFirstEditorGroup");
  }
  return panel;
}

function sampleQuery(engine: EngineId): string {
  switch (engine) {
    case "postgres":
    case "pglite":
      return `-- PostgreSQL hello\nselect version();\n\n-- list tables in the current schema\nselect schemaname, tablename\n  from pg_tables\n where schemaname not in ('pg_catalog', 'information_schema')\n order by 1, 2;\n`;
    case "mysql":
      return `-- MySQL hello\nselect version();\n\n-- list tables in the current database\nshow tables;\n`;
    case "sqlite":
      return `-- SQLite hello\nselect sqlite_version();\n\n-- list user tables\nselect name from sqlite_master where type = 'table' order by name;\n`;
    case "clickhouse":
      return `-- ClickHouse hello\nselect version();\n\n-- recent tables\nselect database, name, engine\n  from system.tables\n where database not in ('system', 'INFORMATION_SCHEMA')\n order by database, name\n limit 50;\n`;
  }
}
